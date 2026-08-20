import { describe, expect, it } from "vitest";
import { createKvRateLimitStore } from "@demiurgejs/core/kv";
import { createFakeKvNamespace } from "./fake-kv-namespace";

describe("createKvRateLimitStore", () => {
  it("starts a key at count 1 with resetAt windowMs after now", async () => {
    const store = createKvRateLimitStore({ namespace: createFakeKvNamespace() });
    const now = Date.now();

    const result = await store.increment("client:1", 60_000, now);

    expect(result).toEqual({ count: 1, resetAt: now + 60_000 });
  });

  it("increments the count on repeated calls within the window", async () => {
    const store = createKvRateLimitStore({ namespace: createFakeKvNamespace() });
    const now = Date.now();

    await store.increment("client:1", 60_000, now);
    const second = await store.increment("client:1", 60_000, now + 1_000);
    const third = await store.increment("client:1", 60_000, now + 2_000);

    expect(second).toEqual({ count: 2, resetAt: now + 60_000 });
    expect(third).toEqual({ count: 3, resetAt: now + 60_000 });
  });

  it("resets the count once the window has elapsed", async () => {
    const store = createKvRateLimitStore({ namespace: createFakeKvNamespace() });
    const now = Date.now();

    await store.increment("client:1", 60_000, now);
    await store.increment("client:1", 60_000, now + 1_000);

    const afterWindow = await store.increment("client:1", 60_000, now + 61_000);

    expect(afterWindow).toEqual({ count: 1, resetAt: now + 61_000 + 60_000 });
  });

  it("tracks separate keys independently", async () => {
    const store = createKvRateLimitStore({ namespace: createFakeKvNamespace() });
    const now = Date.now();

    const first = await store.increment("client:1", 60_000, now);
    const second = await store.increment("client:2", 60_000, now);

    expect(first).toEqual({ count: 1, resetAt: now + 60_000 });
    expect(second).toEqual({ count: 1, resetAt: now + 60_000 });
  });

  it("scopes counter keys under keyPrefix", async () => {
    const namespace = createFakeKvNamespace();
    const store = createKvRateLimitStore({ keyPrefix: "app:rate-limit:", namespace });
    const now = Date.now();

    await store.increment("client:1", 60_000, now);

    expect(await namespace.get("app:rate-limit:client:1")).toBe(
      JSON.stringify({ count: 1, resetAt: now + 60_000 }),
    );
  });

  it("uses the default key prefix when none is given", async () => {
    const namespace = createFakeKvNamespace();
    const store = createKvRateLimitStore({ namespace });
    const now = Date.now();

    await store.increment("client:1", 60_000, now);

    expect(await namespace.get("demiurge:rate-limit:client:1")).toBe(
      JSON.stringify({ count: 1, resetAt: now + 60_000 }),
    );
  });
});

describe("createKvRateLimitStore without a namespace", () => {
  it("throws a clear error instead of rate limiting silently", () => {
    expect(() =>
      createKvRateLimitStore(
        // @ts-expect-error deliberately omitting the required namespace
        { keyPrefix: "test:" },
      )
    ).toThrow(
      "Demiurge KV rate limit store requires an EdgeKvNamespace. Pass a connected KV client matching the get/put/delete/list interface documented on EdgeKvNamespace.",
    );
  });
});
