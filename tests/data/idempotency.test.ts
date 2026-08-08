import { describe, expect, it, vi } from "vitest";
import {
  createMemoryIdempotencyStore,
  runIdempotentMutation,
} from "demiurge";

describe("idempotent mutations", () => {
  it("replays completed mutation results for the same key", async () => {
    const store = createMemoryIdempotencyStore();
    const createPost = vi.fn(async () => ({
      id: createPost.mock.calls.length,
      slug: "hello",
    }));

    const first = await runIdempotentMutation(store, {
      fn: createPost,
      key: ["create-post", "client-key"],
      ttl: "1h",
    });
    const second = await runIdempotentMutation(store, {
      fn: createPost,
      key: ["create-post", "client-key"],
      ttl: "1h",
    });

    expect(first).toEqual({
      key: '["create-post","client-key"]',
      replayed: false,
      value: {
        id: 1,
        slug: "hello",
      },
    });
    expect(second).toEqual({
      key: '["create-post","client-key"]',
      replayed: true,
      value: {
        id: 1,
        slug: "hello",
      },
    });
    expect(createPost).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent mutations with the same key", async () => {
    const store = createMemoryIdempotencyStore();
    const createPost = vi.fn(async () => {
      await Promise.resolve();
      return "created";
    });

    const [first, second] = await Promise.all([
      runIdempotentMutation(store, {
        fn: createPost,
        key: ["mutation", "retry-key"],
      }),
      runIdempotentMutation(store, {
        fn: createPost,
        key: ["mutation", "retry-key"],
      }),
    ]);

    expect(first).toEqual({
      key: '["mutation","retry-key"]',
      replayed: false,
      value: "created",
    });
    expect(second).toEqual({
      key: '["mutation","retry-key"]',
      replayed: true,
      value: "created",
    });
    expect(createPost).toHaveBeenCalledTimes(1);
  });

  it("expires completed mutation results after TTL", async () => {
    let now = 0;
    const store = createMemoryIdempotencyStore({ now: () => now });
    const createPost = vi.fn(async () => `created-${createPost.mock.calls.length}`);

    await expect(
      runIdempotentMutation(store, {
        fn: createPost,
        key: ["mutation", "ttl"],
        ttl: "1s",
      }),
    ).resolves.toEqual({
      key: '["mutation","ttl"]',
      replayed: false,
      value: "created-1",
    });

    now = 1_001;

    await expect(
      runIdempotentMutation(store, {
        fn: createPost,
        key: ["mutation", "ttl"],
        ttl: "1s",
      }),
    ).resolves.toEqual({
      key: '["mutation","ttl"]',
      replayed: false,
      value: "created-2",
    });
    expect(createPost).toHaveBeenCalledTimes(2);
  });

  it("does not cache failed mutations", async () => {
    const store = createMemoryIdempotencyStore();
    const createPost = vi
      .fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce("created");

    await expect(
      runIdempotentMutation(store, {
        fn: createPost,
        key: ["mutation", "failure"],
      }),
    ).rejects.toThrow("database unavailable");
    await expect(
      runIdempotentMutation(store, {
        fn: createPost,
        key: ["mutation", "failure"],
      }),
    ).resolves.toEqual({
      key: '["mutation","failure"]',
      replayed: false,
      value: "created",
    });
    expect(createPost).toHaveBeenCalledTimes(2);
  });
});
