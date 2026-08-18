import { spawnSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Redis } from "ioredis";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { createRedisCacheStore } from "@demiurgejs/core/redis";
import {
  verifyCacheStoreContract,
  verifyCacheStoreRefreshContract,
} from "../../src/data/testing";
import type { CacheStoreEntry } from "../../src/data/cache";

// These tests run against a real `redis-server` binary rather than a mock.
// Tag invalidation across processes is this store's entire value over the
// memory store. A mock that only replays one process's idea of Redis cannot
// prove two ioredis clients coordinate through the same server.
// `hasRedisServer` gates the suite instead of failing CI on a machine
// without the binary on PATH.
const hasRedisServer = spawnSync("redis-server", ["--version"]).status === 0;
const port = 21_000 + (process.pid % 10_000);

describe.skipIf(!hasRedisServer)("createRedisCacheStore", () => {
  let server: ChildProcessWithoutNullStreams;
  let clientA: Redis;
  let clientB: Redis;

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

    // Two independent connections stand in for two application processes
    // sharing one Redis instance.
    clientA = new Redis({ host: "127.0.0.1", lazyConnect: true, port });
    clientB = new Redis({ host: "127.0.0.1", lazyConnect: true, port });
    await clientA.connect();
    await clientB.connect();
  }, 20_000);

  afterAll(async () => {
    clientA?.disconnect();
    clientB?.disconnect();
    server?.kill("SIGTERM");
  });

  it("satisfies the cache store contract", async () => {
    await expect(
      verifyCacheStoreContract(() =>
        createRedisCacheStore({ client: clientA, keyPrefix: `contract:${Date.now()}:` })
      ),
    ).resolves.toBeUndefined();
  });

  it("satisfies the atomic stale-refresh contract", async () => {
    await expect(
      verifyCacheStoreRefreshContract(() =>
        createRedisCacheStore({ client: clientA, keyPrefix: `refresh:${Date.now()}:` })
      ),
    ).resolves.toBeUndefined();
  });

  it("invalidates a tag across two separate client connections", async () => {
    const keyPrefix = `cross-instance:${Date.now()}:`;
    const storeA = createRedisCacheStore({ client: clientA, keyPrefix });
    const storeB = createRedisCacheStore({ client: clientB, keyPrefix });
    const future = Date.now() + 60_000;
    const entry: CacheStoreEntry = {
      expiresAt: future,
      staleUntil: future + 5_000,
      tags: ["posts"],
      value: { title: "cross-instance" },
    };

    await storeA.set("post:1", entry);
    expect(await storeB.get("post:1")).toEqual(entry);

    const deleted = await storeB.invalidateTags(["posts"]);
    expect(deleted).toBe(1);

    expect(await storeA.get("post:1")).toBeUndefined();
    expect(await storeB.get("post:1")).toBeUndefined();
  });

  it("coordinates a refresh lease across two separate client connections", async () => {
    const keyPrefix = `cross-instance-refresh:${Date.now()}:`;
    const storeA = createRedisCacheStore({ client: clientA, keyPrefix });
    const storeB = createRedisCacheStore({ client: clientB, keyPrefix });
    const leaseExpiresAt = Date.now() + 60_000;

    expect(
      await storeA.acquireRefreshLease!("post:2", "owner-a", leaseExpiresAt),
    ).toBe(true);
    expect(
      await storeB.acquireRefreshLease!("post:2", "owner-b", leaseExpiresAt),
    ).toBe(false);

    const future = Date.now() + 60_000;
    const refreshed: CacheStoreEntry = {
      expiresAt: future,
      staleUntil: future + 5_000,
      tags: [],
      value: "refreshed-from-a",
    };

    expect(
      await storeB.publishRefresh!("post:2", "owner-b", refreshed),
    ).toBe(false);
    expect(
      await storeA.publishRefresh!("post:2", "owner-a", refreshed),
    ).toBe(true);
    expect(await storeB.get("post:2")).toEqual(refreshed);
  });

  it("reuses defined commands when building a second store on the same client", async () => {
    const keyPrefix = `reuse:${Date.now()}:`;
    const store = createRedisCacheStore({ client: clientA, keyPrefix });
    const another = createRedisCacheStore({ client: clientA, keyPrefix });
    const entry: CacheStoreEntry = {
      expiresAt: null,
      staleUntil: null,
      tags: [],
      value: "persisted",
    };

    await store.set("forever", entry);
    expect(await another.get("forever")).toEqual(entry);
    expect(await another.delete("forever")).toBe(true);
    expect(await store.delete("forever")).toBe(false);
  });

  it("returns zero for invalidateTags with no tags", async () => {
    const store = createRedisCacheStore({
      client: clientA,
      keyPrefix: `empty-tags:${Date.now()}:`,
    });

    expect(await store.invalidateTags([])).toBe(0);
  });

  it("uses the default key prefix when none is given", async () => {
    const store = createRedisCacheStore({ client: clientA });
    const entry: CacheStoreEntry = {
      expiresAt: null,
      staleUntil: null,
      tags: [],
      value: "default-prefix",
    };
    const key = `default-prefix-check:${Date.now()}`;

    await store.set(key, entry);
    expect(await clientA.get(`demiurge:cache:entry:${key}`)).toBe(
      JSON.stringify(entry),
    );
    await store.delete(key);
  });

  it("releases a refresh lease it does not own without acting on it", async () => {
    const store = createRedisCacheStore({
      client: clientA,
      keyPrefix: `release:${Date.now()}:`,
    });
    const leaseExpiresAt = Date.now() + 60_000;
    const key = "release-check";

    expect(await store.acquireRefreshLease!(key, "owner", leaseExpiresAt))
      .toBe(true);
    await store.releaseRefreshLease!(key, "not-the-owner");
    expect(await store.acquireRefreshLease!(key, "second-owner", leaseExpiresAt))
      .toBe(false);
  });
});

describe("createRedisCacheStore without a client", () => {
  it("throws a clear error instead of caching silently", () => {
    expect(() =>
      createRedisCacheStore(
        // @ts-expect-error deliberately omitting the required client
        { keyPrefix: "test:" },
      )
    ).toThrow(
      "Demiurge Redis cache store requires an ioredis client. Pass a connected ioredis Redis instance as `client`.",
    );
  });
});
