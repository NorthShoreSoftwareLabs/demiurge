import { spawnSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Redis } from "ioredis";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { createMemoryCacheStore } from "@demiurgejs/core";
import { createRedisCacheStore } from "@demiurgejs/core/redis";
import { createTieredCacheStore } from "../../src/data/tiered";
import {
  verifyCacheStoreContract,
  verifyCacheStoreRefreshContract,
} from "../../src/data/testing";
import type { CacheStoreEntry } from "../../src/data/cache";

// These tests run against a real `redis-server` binary for `l2`, consistent
// with the rest of the cache store suite. A mock l2 can't prove the tiered
// store actually treats a shared backend as the source of truth.
const hasRedisServer = spawnSync("redis-server", ["--version"]).status === 0;
const port = 22_000 + (process.pid % 10_000);

describe.skipIf(!hasRedisServer)("createTieredCacheStore", () => {
  let server: ChildProcessWithoutNullStreams;
  let client: Redis;

  beforeAll(async () => {
    server = spawn("redis-server", [
      "--port",
      String(port),
      "--bind",
      "127.0.0.1",
      "--save",
      "",
      "--appendonly",
      "no",
      "--daemonize",
      "no",
    ]);

    await new Promise<void>((resolvePromise, reject) => {
      let output = "";
      const onData = (chunk: Buffer) => {
        output += chunk.toString("utf8");
        if (output.includes("Ready to accept connections")) {
          server.stdout.off("data", onData);
          resolvePromise();
        }
      };
      server.stdout.on("data", onData);
      server.once("error", reject);
      server.once("exit", (code) => {
        reject(new Error(`redis-server exited early with code ${code}.`));
      });
    });

    client = new Redis({ host: "127.0.0.1", lazyConnect: true, port });
    await client.connect();
  }, 20_000);

  afterAll(async () => {
    client?.disconnect();
    server?.kill("SIGTERM");
  });

  it("satisfies the cache store contract with a real memory l1 and Redis l2", async () => {
    await expect(
      verifyCacheStoreContract(() =>
        createTieredCacheStore({
          l1: createMemoryCacheStore(),
          l2: createRedisCacheStore({
            client,
            keyPrefix: `tiered-contract:${Date.now()}:`,
          }),
        })
      ),
    ).resolves.toBeUndefined();
  });

  it("satisfies the atomic stale-refresh contract, delegated to l2", async () => {
    await expect(
      verifyCacheStoreRefreshContract(() =>
        createTieredCacheStore({
          l1: createMemoryCacheStore(),
          l2: createRedisCacheStore({
            client,
            keyPrefix: `tiered-refresh:${Date.now()}:`,
          }),
        })
      ),
    ).resolves.toBeUndefined();
  });

  it("populates l1 from an l2 hit and serves subsequent reads from l1", async () => {
    const l1 = createMemoryCacheStore();
    const l2 = createRedisCacheStore({
      client,
      keyPrefix: `tiered-populate:${Date.now()}:`,
    });
    const store = createTieredCacheStore({ l1, l2 });
    const future = Date.now() + 60_000;
    const entry: CacheStoreEntry = {
      expiresAt: future,
      staleUntil: future + 5_000,
      tags: ["posts"],
      value: { title: "populate-l1" },
    };

    // Write straight to l2, bypassing the tiered store, the way another
    // replica's write would arrive.
    await l2.set("post:1", entry);
    expect(await l1.get("post:1")).toBeUndefined();

    expect(await store.get("post:1")).toEqual(entry);
    expect(await l1.get("post:1")).toEqual(entry);
  });

  it("writes through to l2 first, then l1", async () => {
    const l1 = createMemoryCacheStore();
    const l2 = createRedisCacheStore({
      client,
      keyPrefix: `tiered-write-through:${Date.now()}:`,
    });
    const store = createTieredCacheStore({ l1, l2 });
    const future = Date.now() + 60_000;
    const entry: CacheStoreEntry = {
      expiresAt: future,
      staleUntil: future + 5_000,
      tags: [],
      value: "write-through",
    };

    await store.set("post:2", entry);
    expect(await l1.get("post:2")).toEqual(entry);
    expect(await l2.get("post:2")).toEqual(entry);
  });

  it("deletes from both layers", async () => {
    const l1 = createMemoryCacheStore();
    const l2 = createRedisCacheStore({
      client,
      keyPrefix: `tiered-delete:${Date.now()}:`,
    });
    const store = createTieredCacheStore({ l1, l2 });
    const future = Date.now() + 60_000;

    await store.set("post:3", {
      expiresAt: future,
      staleUntil: future + 5_000,
      tags: [],
      value: "to-delete",
    });

    expect(await store.delete("post:3")).toBe(true);
    expect(await l1.get("post:3")).toBeUndefined();
    expect(await l2.get("post:3")).toBeUndefined();
  });

  it("invalidates tags in both layers", async () => {
    const l1 = createMemoryCacheStore();
    const l2 = createRedisCacheStore({
      client,
      keyPrefix: `tiered-invalidate:${Date.now()}:`,
    });
    const store = createTieredCacheStore({ l1, l2 });
    const future = Date.now() + 60_000;

    await store.set("post:4", {
      expiresAt: future,
      staleUntil: future + 5_000,
      tags: ["posts"],
      value: "tagged",
    });

    expect(await store.invalidateTags(["posts"])).toBe(1);
    expect(await l1.get("post:4")).toBeUndefined();
    expect(await l2.get("post:4")).toBeUndefined();
  });

  it("delegates refresh lease coordination to l2 only", async () => {
    const l1 = createMemoryCacheStore();
    const l2 = createRedisCacheStore({
      client,
      keyPrefix: `tiered-lease:${Date.now()}:`,
    });
    const store = createTieredCacheStore({ l1, l2 });
    const leaseExpiresAt = Date.now() + 60_000;

    expect(
      await store.acquireRefreshLease!("post:5", "owner-a", leaseExpiresAt),
    ).toBe(true);
    // The lease lives only in l2. l1 (a bare memory store) never learns
    // about it.
    expect(
      await l2.acquireRefreshLease!("post:5", "owner-b", leaseExpiresAt),
    ).toBe(false);
    expect(
      await l1.acquireRefreshLease!("post:5", "owner-b", leaseExpiresAt),
    ).toBe(true);
  });

  it("does not see a tag invalidation from another replica until l1 catches up", async () => {
    // This documents the staleness trade-off. l1 is per-process. An
    // invalidation issued directly against l2 (standing in for another
    // replica) is invisible to this process's l1 copy until l1's own
    // TTL/staleUntil evicts it.
    const l1 = createMemoryCacheStore();
    const l2 = createRedisCacheStore({
      client,
      keyPrefix: `tiered-staleness:${Date.now()}:`,
    });
    const store = createTieredCacheStore({ l1, l2 });
    const future = Date.now() + 60_000;
    const entry: CacheStoreEntry = {
      expiresAt: future,
      staleUntil: future + 5_000,
      tags: ["posts"],
      value: "stale-until-ttl",
    };

    await store.set("post:6", entry);
    // Another replica invalidates the tag directly against the shared l2.
    expect(await l2.invalidateTags(["posts"])).toBe(1);

    // This process's l1 still has its own copy and serves it.
    expect(await store.get("post:6")).toEqual(entry);
  });
});
