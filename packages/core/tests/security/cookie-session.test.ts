import { describe, expect, it } from "vitest";
import {
  createEncryptedCookieSession,
  createSignedCookieSession,
  type CookieSessionManager,
  type SessionCookieKey,
} from "@demiurgejs/core";

type TestSessionData = {
  authenticated: boolean;
  userId: string;
};

const currentKey = key("current", 11);
const previousKey = key("previous", 29);
const now = Date.UTC(2030, 0, 1);

describe.each([
  ["signed", createSignedCookieSession<TestSessionData>],
  ["encrypted", createEncryptedCookieSession<TestSessionData>],
] as const)("%s cookie sessions", (_name, createManager) => {
  it("creates, reads, updates, rotates, and destroys a session", async () => {
    const manager = createManager({
      keys: [currentKey],
      now: () => now,
      randomBytes: deterministicRandom(),
    });
    const session = await manager.open(request());
    const created = session.create({ authenticated: false, userId: "alpha" });

    expect(created.id).toHaveLength(43);
    expect(created.expiresAt).toBe(now + 7 * 24 * 60 * 60 * 1000);
    expect(created.idleExpiresAt).toBe(now + 24 * 60 * 60 * 1000);
    expect(created.version).toBe(0);

    const setCookie = await oneCookie(session.commit());
    expect(setCookie).toContain("__Host-session=");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");

    const loaded = await manager.open(request(cookiePair(setCookie)));
    expect(loaded.get()).toEqual(created);
    expect(await loaded.commit()).toEqual([]);

    const updated = loaded.update({ authenticated: true, userId: "alpha" });
    expect(updated.version).toBe(1);
    expect(updated.id).toBe(created.id);

    const rotated = loaded.rotate();
    expect(rotated.id).not.toBe(created.id);
    expect(rotated.version).toBe(2);
    expect(rotated.data.authenticated).toBe(true);

    loaded.destroy();
    expect(loaded.get()).toBeUndefined();
    expect(await oneCookie(loaded.commit())).toContain("Max-Age=0");
  });

  it("fails closed for a tampered value", async () => {
    const manager = createManager({
      keys: [currentKey],
      now: () => now,
      randomBytes: deterministicRandom(),
    });
    const created = await manager.open(request());
    created.create({ authenticated: true, userId: "alpha" });
    const original = cookiePair(await oneCookie(created.commit()));
    const tampered = `${original.slice(0, -1)}${original.endsWith("a") ? "b" : "a"}`;
    const opened = await manager.open(request(tampered));

    expect(opened.get()).toBeUndefined();
    expect(await oneCookie(opened.commit())).toContain("Max-Age=0");
  });

  it("accepts a previous key and commits with the current key", async () => {
    const oldManager = createManager({
      keys: [previousKey],
      now: () => now,
      randomBytes: deterministicRandom(),
    });
    const oldSession = await oldManager.open(request());
    oldSession.create({ authenticated: true, userId: "alpha" });
    const oldCookie = cookiePair(await oneCookie(oldSession.commit()));
    const manager = createManager({
      keys: [currentKey, previousKey],
      now: () => now,
      randomBytes: deterministicRandom(),
    });
    const opened = await manager.open(request(oldCookie));

    expect(opened.get()?.data.userId).toBe("alpha");
    expect(await oneCookie(opened.commit())).toContain(
      encodeURIComponent(`${_name === "signed" ? "s1" : "e1"}.current.`),
    );
  });

  it("expires an idle session and does not return its data", async () => {
    let currentTime = now;
    const manager = createManager({
      idleExpirationMs: 1_000,
      keys: [currentKey],
      now: () => currentTime,
      randomBytes: deterministicRandom(),
    });
    const created = await manager.open(request());
    created.create({ authenticated: true, userId: "alpha" });
    const cookie = cookiePair(await oneCookie(created.commit()));

    currentTime += 1_001;
    const expired = await manager.open(request(cookie));
    expect(expired.get()).toBeUndefined();
    expect(await oneCookie(expired.commit())).toContain("Max-Age=0");
  });
});

describe("signed cookie sessions", () => {
  it("protects integrity without hiding the payload", async () => {
    const manager = createSignedCookieSession<TestSessionData>({
      keys: [currentKey],
      now: () => now,
      randomBytes: deterministicRandom(),
    });
    const session = await manager.open(request());
    session.create({ authenticated: true, userId: "visible-user" });
    const cookie = decodeURIComponent(await oneCookie(session.commit()));

    expect(cookie).toContain("s1.current.");
    expect(decodeSignedPayload(cookie)).toContain("visible-user");
  });
});

describe("encrypted cookie sessions", () => {
  it("does not expose session data in the cookie value", async () => {
    const manager = createEncryptedCookieSession<TestSessionData>({
      keys: [currentKey],
      now: () => now,
      randomBytes: deterministicRandom(),
    });
    const session = await manager.open(request());
    session.create({ authenticated: true, userId: "private-user" });
    const cookie = decodeURIComponent(await oneCookie(session.commit()));

    expect(cookie).toContain("e1.current.");
    expect(cookie).not.toContain("private-user");
  });
});

describe("cookie session validation", () => {
  it("requires a current key with at least 256 bits", () => {
    expect(() => createSignedCookieSession({ keys: [] })).toThrow(
      "require at least one key",
    );
    expect(() =>
      createEncryptedCookieSession({
        keys: [{ id: "short", value: new Uint8Array(31) }],
      })
    ).toThrow("must contain at least 32 bytes");
    expect(() =>
      createEncryptedCookieSession({
        keys: [{ id: "long", value: new Uint8Array(33) }],
      })
    ).toThrow("exactly 32 bytes for AES-256-GCM");
  });

  it("rejects cookie payloads above the browser limit", async () => {
    const manager = createSignedCookieSession<{ value: string }>({
      keys: [currentKey],
      now: () => now,
      randomBytes: deterministicRandom(),
    });
    const session = await manager.open(request());
    session.create({ value: "x".repeat(4_000) });

    await expect(session.commit()).rejects.toThrow("above 4096 bytes");
  });

  it("rejects non-JSON session data", async () => {
    const manager = createSignedCookieSession<TestSessionData>({
      keys: [currentKey],
      now: () => now,
      randomBytes: deterministicRandom(),
    });
    const session = await manager.open(request());
    const invalidUserId: unknown = Number.NaN;

    expect(() =>
      session.create({
        authenticated: true,
        // TYPE-EVIDENCE: this invalid runtime value verifies the public data guard.
        userId: invalidUserId as string,
      })
    ).toThrow("finite JSON values");
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

function decodeSignedPayload(cookie: string) {
  const value = cookiePair(cookie).split("=", 2)[1];
  const payload = value.split(".")[2];
  const base64 = payload.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - payload.length % 4) % 4);
  return new TextDecoder().decode(
    Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)),
  );
}

const _typeCheck: CookieSessionManager<TestSessionData> =
  createSignedCookieSession<TestSessionData>({ keys: [currentKey] });
void _typeCheck;
