import { spawnSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Redis } from "ioredis";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { createRedisRateLimitStore } from "@demiurgejs/core/redis";

// These tests run against a real `redis-server` binary rather than a mock,
// the same way `packages/core/tests/redis/store.test.ts` does. Atomic
// cross-instance counting is this store's entire value over the memory
// store. A mock only replays one process's idea of Redis. It can't prove
// two ioredis clients racing to increment the same key still get correct,
// non-overlapping counts. `hasRedisServer` gates the suite instead of
// failing CI on a machine without the binary on PATH.
const hasRedisServer = spawnSync("redis-server", ["--version"]).status === 0;
const port = 22_000 + (process.pid % 10_000);

describe.skipIf(!hasRedisServer)("createRedisRateLimitStore", () => {
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

  it("counts the first request in a fresh window as 1", async () => {
    const store = createRedisRateLimitStore({
      client: clientA,
      keyPrefix: `first:${Date.now()}:`,
    });

    const result = await store.increment("alice", 60_000, Date.now());

    expect(result.count).toBe(1);
    expect(result.resetAt).toBeGreaterThan(Date.now());
    expect(result.resetAt).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it("increments the same counter on repeated calls within the window", async () => {
    const store = createRedisRateLimitStore({
      client: clientA,
      keyPrefix: `repeat:${Date.now()}:`,
    });

    const first = await store.increment("bob", 60_000, Date.now());
    const second = await store.increment("bob", 60_000, Date.now());
    const third = await store.increment("bob", 60_000, Date.now());

    expect(first.count).toBe(1);
    expect(second.count).toBe(2);
    expect(third.count).toBe(3);
    // The window's reset time is fixed by the first increment, not extended
    // by later ones, matching the memory store's fixed-window semantics.
    expect(second.resetAt).toBe(first.resetAt);
    expect(third.resetAt).toBe(first.resetAt);
  });

  it("tracks independent keys separately", async () => {
    const store = createRedisRateLimitStore({
      client: clientA,
      keyPrefix: `independent:${Date.now()}:`,
    });

    await store.increment("carol", 60_000, Date.now());
    await store.increment("carol", 60_000, Date.now());
    const dave = await store.increment("dave", 60_000, Date.now());

    expect(dave.count).toBe(1);
  });

  it("coordinates counts across two separate client connections", async () => {
    const keyPrefix = `cross-instance:${Date.now()}:`;
    const storeA = createRedisRateLimitStore({ client: clientA, keyPrefix });
    const storeB = createRedisRateLimitStore({ client: clientB, keyPrefix });

    const first = await storeA.increment("shared", 60_000, Date.now());
    const second = await storeB.increment("shared", 60_000, Date.now());
    const third = await storeA.increment("shared", 60_000, Date.now());

    expect(first.count).toBe(1);
    expect(second.count).toBe(2);
    expect(third.count).toBe(3);
  });

  it("resolves concurrent increments from two clients to distinct, non-overlapping counts", async () => {
    const keyPrefix = `concurrent:${Date.now()}:`;
    const storeA = createRedisRateLimitStore({ client: clientA, keyPrefix });
    const storeB = createRedisRateLimitStore({ client: clientB, keyPrefix });

    const results = await Promise.all([
      storeA.increment("race", 60_000, Date.now()),
      storeB.increment("race", 60_000, Date.now()),
    ]);

    const counts = results.map((result) => result.count).sort();
    expect(counts).toEqual([1, 2]);
  });

  it("resets the counter once the window has elapsed", async () => {
    const store = createRedisRateLimitStore({
      client: clientA,
      keyPrefix: `expire:${Date.now()}:`,
    });

    const first = await store.increment("erin", 200, Date.now());
    expect(first.count).toBe(1);

    await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 400));

    const second = await store.increment("erin", 200, Date.now());
    expect(second.count).toBe(1);
    expect(second.resetAt).toBeGreaterThan(first.resetAt);
  });

  it("reuses the defined command when building a second store on the same client", async () => {
    const keyPrefix = `reuse:${Date.now()}:`;
    const store = createRedisRateLimitStore({ client: clientA, keyPrefix });
    const another = createRedisRateLimitStore({ client: clientA, keyPrefix });

    await store.increment("frank", 60_000, Date.now());
    const result = await another.increment("frank", 60_000, Date.now());

    expect(result.count).toBe(2);
  });

  it("uses the default key prefix when none is given", async () => {
    const store = createRedisRateLimitStore({ client: clientA });
    const key = `default-prefix-check:${Date.now()}`;

    await store.increment(key, 60_000, Date.now());
    expect(await clientA.get(`demiurge:ratelimit:${key}`)).toBe("1");
  });
});

describe("createRedisRateLimitStore without a client", () => {
  it("throws a clear error instead of counting silently", () => {
    expect(() =>
      createRedisRateLimitStore(
        // @ts-expect-error deliberately omitting the required client
        { keyPrefix: "test:" },
      )
    ).toThrow(
      "Demiurge Redis rate limit store requires an ioredis client. Pass a connected ioredis Redis instance as `client`.",
    );
  });
});
