import { describe, expect, it, vi } from "vitest";
import {
  createMemoryIdempotencyStore,
  runIdempotentMutation,
} from "@demiurge-js/core";

describe("idempotent mutations", () => {
  it("uses a finite configurable default TTL", async () => {
    let now = 0;
    const store = createMemoryIdempotencyStore({
      defaultTtl: "1s",
      now: () => now,
    });
    const mutation = vi.fn(async () => mutation.mock.calls.length);
    const request = { fn: mutation, key: ["default-ttl"] } as const;

    await expect(store.run(request)).resolves.toMatchObject({ value: 1 });
    now = 999;
    await expect(store.run(request)).resolves.toMatchObject({
      replayed: true,
      value: 1,
    });
    now = 1_000;
    await expect(store.run(request)).resolves.toMatchObject({
      replayed: false,
      value: 2,
    });
  });

  it("bounds completed results with oldest-entry eviction", async () => {
    const store = createMemoryIdempotencyStore({ maximumEntries: 2 });
    const mutation = vi.fn(async (value: string) => value);

    for (const value of ["first", "second", "third"]) {
      await store.run({ fn: () => mutation(value), key: [value] });
    }

    const replay = await store.run({ fn: () => mutation("first"), key: ["first"] });
    expect(replay.replayed).toBe(false);
    expect(mutation).toHaveBeenCalledTimes(4);
  });

  it("never expires or evicts in-flight mutations", async () => {
    let now = 0;
    let resolveMutation!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      resolveMutation = resolve;
    });
    const mutation = vi.fn(() => pending);
    const store = createMemoryIdempotencyStore({ maximumEntries: 1, now: () => now });
    const first = store.run({ fn: mutation, key: ["slow"], ttl: 1 });

    now = 10_000;
    const replay = store.run({ fn: mutation, key: ["slow"], ttl: 1 });
    await expect(
      store.run({ fn: async () => "other", key: ["other"] }),
    ).rejects.toThrow(
      "Demiurge idempotency store is at capacity with in-flight mutations.",
    );
    resolveMutation("done");

    await expect(first).resolves.toMatchObject({ replayed: false, value: "done" });
    await expect(replay).resolves.toMatchObject({ replayed: true, value: "done" });
    expect(mutation).toHaveBeenCalledTimes(1);
  });

  it("validates in-memory idempotency limits", () => {
    expect(() => createMemoryIdempotencyStore({ maximumEntries: 0 })).toThrow(
      "Demiurge idempotency maximumEntries must be a positive integer.",
    );
    expect(() =>
      createMemoryIdempotencyStore({ defaultTtl: Number.POSITIVE_INFINITY }),
    ).toThrow("Demiurge cache duration must be a non-negative integer.");
  });

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
