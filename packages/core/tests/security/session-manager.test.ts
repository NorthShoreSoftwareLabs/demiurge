import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  createSessionManager,
  SessionStoreConflictError,
  SessionStoreUnavailableError,
  type SessionCookieKey,
} from "@demiurgejs/core";

type TestData = { authenticated: boolean; userId: string };

const namespace = { app: "manager", environment: "test", schemaVersion: 1 };
const currentKey = key("current", 17);
const previousKey = key("previous", 23);
const now = Date.UTC(2030, 0, 1);

describe("createSessionManager", () => {
  it("creates, updates, rotates, and revokes a stored session", async () => {
    const entries = new Map();
    const manager = createSessionManager<TestData>({
      keys: [currentKey],
      now: () => now,
      randomBytes: deterministicRandom(),
      store: createMemorySessionStore({ entries, namespace }),
    });
    const createdRequest = await manager.open(request());
    const created = await createdRequest.create({
      authenticated: false,
      userId: "alpha",
    });
    const createdCookie = cookiePair(await oneCookie(createdRequest.commit()));

    expect(created.version).toBe(0);
    expect(createdCookie).toContain("i1.current.");

    const updateRequest = await manager.open(request(createdCookie));
    const updated = await updateRequest.update({
      authenticated: true,
      userId: "alpha",
    });
    const rotated = await updateRequest.rotate();
    const rotatedCookie = cookiePair(await oneCookie(updateRequest.commit()));

    expect(updated.version).toBe(1);
    expect(rotated.version).toBe(2);
    expect(rotated.id).not.toBe(created.id);

    const logoutRequest = await manager.open(request(rotatedCookie));
    expect(logoutRequest.get()?.data.authenticated).toBe(true);
    await logoutRequest.destroy();
    expect(await oneCookie(logoutRequest.commit())).toContain("Max-Age=0");

    const replay = await manager.open(request(rotatedCookie));
    expect(replay.get()).toBeUndefined();
  });

  it("accepts a previous signing key and commits the current key", async () => {
    const entries = new Map();
    const store = createMemorySessionStore<TestData>({ entries, namespace });
    const oldManager = createSessionManager({
      keys: [previousKey],
      now: () => now,
      randomBytes: deterministicRandom(),
      store,
    });
    const oldRequest = await oldManager.open(request());
    await oldRequest.create({ authenticated: true, userId: "alpha" });
    const oldCookie = cookiePair(await oneCookie(oldRequest.commit()));
    const manager = createSessionManager({
      keys: [currentKey, previousKey],
      now: () => now,
      randomBytes: deterministicRandom(),
      store,
    });
    const opened = await manager.open(request(oldCookie));

    expect(opened.get()?.data.userId).toBe("alpha");
    expect(await oneCookie(opened.commit())).toContain("i1.current.");
  });

  it("reports a concurrent update conflict without changing the cookie", async () => {
    const entries = new Map();
    const manager = createSessionManager<TestData>({
      keys: [currentKey],
      now: () => now,
      randomBytes: deterministicRandom(),
      store: createMemorySessionStore({ entries, namespace }),
    });
    const initial = await manager.open(request());
    await initial.create({ authenticated: false, userId: "alpha" });
    const cookie = cookiePair(await oneCookie(initial.commit()));
    const first = await manager.open(request(cookie));
    const second = await manager.open(request(cookie));

    await first.update({ authenticated: true, userId: "alpha" });
    await expect(
      second.update({ authenticated: false, userId: "beta" }),
    ).rejects.toBeInstanceOf(SessionStoreConflictError);
    expect(await second.commit()).toEqual([]);
  });

  it("fails closed for a modified identifier cookie", async () => {
    const manager = createSessionManager<TestData>({
      keys: [currentKey],
      now: () => now,
      randomBytes: deterministicRandom(),
      store: createMemorySessionStore({ namespace }),
    });
    const initial = await manager.open(request());
    await initial.create({ authenticated: true, userId: "alpha" });
    const cookie = cookiePair(await oneCookie(initial.commit()));
    const tampered = `${cookie.slice(0, -1)}${cookie.endsWith("a") ? "b" : "a"}`;
    const opened = await manager.open(request(tampered));

    expect(opened.get()).toBeUndefined();
    expect(await oneCookie(opened.commit())).toContain("Max-Age=0");
  });

  it("renews idle expiration near the configured threshold", async () => {
    let currentTime = now;
    const manager = createSessionManager<TestData>({
      idleExpirationMs: 1_000,
      keys: [currentKey],
      now: () => currentTime,
      randomBytes: deterministicRandom(),
      store: createMemorySessionStore({ namespace }),
    });
    const initial = await manager.open(request());
    await initial.create({ authenticated: true, userId: "alpha" });
    const cookie = cookiePair(await oneCookie(initial.commit()));

    currentTime += 800;
    const renewed = await manager.open(request(cookie));
    expect(renewed.get()?.idleExpiresAt).toBe(currentTime + 1_000);
    expect(renewed.get()?.version).toBe(1);
    expect(await renewed.commit()).toHaveLength(1);
  });

  it("supports sessions without idle expiration", async () => {
    const manager = createSessionManager<TestData>({
      idleExpirationMs: false,
      keys: [currentKey],
      now: () => now,
      randomBytes: deterministicRandom(),
      store: createMemorySessionStore({ namespace }),
    });
    const session = await manager.open(request());
    const created = await session.create({ authenticated: true, userId: "alpha" });

    expect(created.idleExpiresAt).toBeUndefined();
  });

  it("reports an unavailable lifecycle write", async () => {
    const manager = createSessionManager<TestData>({
      keys: [currentKey],
      now: () => now,
      randomBytes: deterministicRandom(),
      store: {
        create: () => ({ status: "unavailable" }),
        destroy: () => false,
        read: () => undefined,
        rotate: () => ({ status: "unavailable" }),
        update: () => ({ status: "unavailable" }),
      },
    });
    const session = await manager.open(request());

    await expect(
      session.create({ authenticated: true, userId: "alpha" }),
    ).rejects.toBeInstanceOf(SessionStoreUnavailableError);
    expect(await session.commit()).toEqual([]);
  });

  it("validates stores, keys, and lifetimes during construction", () => {
    const store = createMemorySessionStore<TestData>({ namespace });

    expect(() =>
      createSessionManager({ keys: [], store })
    ).toThrow("requires at least one key");
    expect(() =>
      createSessionManager({
        keys: [{ id: "short", value: new Uint8Array(31) }],
        store,
      })
    ).toThrow("must contain at least 32 bytes");
    expect(() =>
      createSessionManager({
        absoluteExpirationMs: 0,
        keys: [currentKey],
        store,
      })
    ).toThrow("must be a positive whole number");
    expect(() =>
      createSessionManager({
        keys: [currentKey, currentKey],
        store,
      })
    ).toThrow("must be unique token values");
  });
});

function key(id: string, byte: number): SessionCookieKey {
  return { id, value: new Uint8Array(32).fill(byte) };
}

function deterministicRandom() {
  let seed = 0;
  return (length: number) =>
    Uint8Array.from({ length }, () => seed++ % 256);
}

function request(cookie?: string) {
  return new Request("https://example.test/account", {
    headers: cookie ? { cookie } : undefined,
  });
}

async function oneCookie(headers: Promise<readonly string[]> | readonly string[]) {
  const resolved = await headers;
  expect(resolved).toHaveLength(1);
  return resolved[0];
}

function cookiePair(setCookie: string) {
  return setCookie.split(";", 1)[0];
}
