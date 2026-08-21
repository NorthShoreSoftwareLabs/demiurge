import { describe, expect, it, vi } from "vitest";
import {
  cacheNotFound,
  CacheNotFoundError,
  createCache,
  createInvalidation,
  createMemoryCache,
  createMemoryCacheStore,
  defineTags,
  isCacheNotFoundError,
  parseCacheDuration,
  query,
  serializeCacheKey,
  serializeCacheNamespace,
  tag,
} from "@demiurgejs/core";

describe("data cache primitives", () => {
  it("creates typed query requests with stable keys and tags", async () => {
    const tags = defineTags({
      post: (input: { slug: string }) => tag(`post:${input.slug}`),
      posts: () => tag("posts"),
    });
    const postBySlug = query({
      fn: async (slug: string) => ({ slug, title: "Hello" }),
      key: (slug: string) => ["post", { slug }],
      scope: "public",
      staleWhileRevalidate: "30s",
      tags: (slug) => [tags.posts(), tags.post({ slug })],
      ttl: "10m",
    });
    const request = postBySlug("hello-world");

    expect(request.key).toEqual(["post", { slug: "hello-world" }]);
    expect(request.scope).toBe("public");
    expect(request.staleWhileRevalidate).toBe("30s");
    expect(request.tags).toEqual([
      { id: "posts" },
      { id: "post:hello-world" },
    ]);
    await expect(request.fn()).resolves.toEqual({
      slug: "hello-world",
      title: "Hello",
    });
  });

  it("serializes cache keys deterministically", () => {
    expect(serializeCacheKey(["post", { locale: "en", slug: "hello" }])).toBe(
      '["post",{"locale":"en","slug":"hello"}]',
    );
    expect(serializeCacheKey(["post", { slug: "hello", locale: "en" }])).toBe(
      '["post",{"locale":"en","slug":"hello"}]',
    );
  });

  it("rejects numeric cache key values that JSON would collapse", () => {
    for (const value of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -0,
    ]) {
      expect(() => serializeCacheKey([value])).toThrow(
        "Demiurge cache keys require finite numbers and do not accept negative zero.",
      );
    }

    expect(serializeCacheKey([0])).not.toBe(serializeCacheKey([null]));
  });

  it("rejects unsupported runtime cache key values recursively", () => {
    expect(() => serializeCacheKey([undefined] as never)).toThrow(
      "Demiurge cache keys do not accept values of type undefined.",
    );
    expect(() => serializeCacheKey([new Date()] as never)).toThrow(
      "Demiurge cache keys accept only primitives, arrays, and plain objects.",
    );
    expect(() =>
      serializeCacheKey([{ nested: { value: Number.NaN } }] as never),
    ).toThrow(
      "Demiurge cache keys require finite numbers and do not accept negative zero.",
    );
  });

  it("rejects circular and hidden cache key object state", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const hidden = Object.defineProperty({}, "value", {
      enumerable: false,
      value: "secret",
    });
    const symbol = { [Symbol("secret")]: "value" };

    expect(() => serializeCacheKey([circular] as never)).toThrow(
      "Demiurge cache keys cannot contain circular references.",
    );
    expect(() => serializeCacheKey([hidden] as never)).toThrow(
      "Demiurge cache key objects require enumerable string data properties.",
    );
    expect(() => serializeCacheKey([symbol] as never)).toThrow(
      "Demiurge cache key objects require enumerable string data properties.",
    );
  });

  it("rejects array holes, custom state, symbols, and accessors", () => {
    const sparse = Array(1);
    const custom = Object.assign([], { custom: true });
    const symbol = Object.assign([], { [Symbol("secret")]: true });
    const accessor = Object.defineProperty([], "0", {
      enumerable: true,
      get: () => "value",
    });
    const objectAccessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => "value",
    });

    for (const value of [sparse, custom, symbol, accessor]) {
      expect(() => serializeCacheKey(value as never)).toThrow(
        "Demiurge cache key arrays must be dense and cannot contain accessors or custom properties.",
      );
    }
    expect(() => serializeCacheKey([objectAccessor] as never)).toThrow(
      "Demiurge cache key objects require enumerable string data properties.",
    );
  });

  it("serializes distinct accepted nested values without collisions", () => {
    const atoms = [null, false, true, -1, 0, 1, "", "0", "value"] as const;
    const values: unknown[] = [...atoms];

    for (const atom of atoms) {
      values.push([atom], [atom, null], { value: atom }, { a: atom, z: null });
    }

    const firstLevel = [...values];
    for (const value of firstLevel) {
      values.push([value, "nested"], { nested: value });
    }

    const serialized = values.map((value) =>
      serializeCacheKey([value] as never),
    );
    expect(new Set(serialized).size).toBe(values.length);
  });

  it("rejects invalid keys before cache store access", async () => {
    const store = {
      delete: vi.fn(),
      get: vi.fn(),
      invalidateTags: vi.fn(),
      set: vi.fn(),
    };
    const cache = createCache({
      namespace: { app: "test", environment: "test", schemaVersion: 1 },
      store,
    });

    await expect(
      cache.get({
        fn: vi.fn(),
        key: [Array(1)] as never,
        scope: "public",
      }),
    ).rejects.toThrow("Demiurge cache key arrays must be dense");
    await expect(cache.invalidateKey([Array(1)] as never)).rejects.toThrow(
      "Demiurge cache key arrays must be dense",
    );
    expect(store.get).not.toHaveBeenCalled();
    expect(store.delete).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
  });

  it("parses cache durations", () => {
    expect(parseCacheDuration(undefined)).toBe(Number.POSITIVE_INFINITY);
    expect(parseCacheDuration(250)).toBe(250);
    expect(parseCacheDuration("250ms")).toBe(250);
    expect(parseCacheDuration("2s")).toBe(2_000);
    expect(parseCacheDuration("3m")).toBe(180_000);
    expect(parseCacheDuration("4h")).toBe(14_400_000);
  });

  it("bounds the in-memory cache with a configurable oldest-entry eviction", () => {
    const entries = new Map();
    const store = createMemoryCacheStore({ entries, maximumEntries: 2 });
    const entry = {
      expiresAt: null,
      staleUntil: null,
      tags: [],
      value: "value",
    };

    store.set("first", entry);
    store.set("second", entry);
    store.set("third", entry);

    expect([...entries.keys()]).toEqual(["second", "third"]);
    expect(() => createMemoryCacheStore({ maximumEntries: 0 })).toThrow(
      "Demiurge memory cache maximumEntries must be a positive integer.",
    );
  });

  it("sweeps expired in-memory cache entries without a background timer", () => {
    let now = 0;
    const entries = new Map();
    const store = createMemoryCacheStore({ entries, maximumEntries: 2, now: () => now });

    store.set("expired", {
      expiresAt: 5,
      staleUntil: 10,
      tags: [],
      value: "old",
    });
    store.set("active", {
      expiresAt: 50,
      staleUntil: 100,
      tags: [],
      value: "active",
    });
    now = 10;
    store.set("new", {
      expiresAt: 50,
      staleUntil: 100,
      tags: [],
      value: "new",
    });

    expect([...entries.keys()]).toEqual(["active", "new"]);
    expect(store.get("expired")).toBeUndefined();
  });

  it("rejects invalid cache durations", () => {
    expect(() => parseCacheDuration(-1)).toThrow(
      "Demiurge cache duration must be a non-negative integer.",
    );
    expect(() => parseCacheDuration("1d" as never)).toThrow(
      "Demiurge cache duration must use an ms/s/m/h suffix.",
    );
  });

  it("dedupes request-scoped cache work inside a cache instance", async () => {
    const cache = createMemoryCache();
    const loadPost = vi.fn(async () => "post");
    const request = {
      fn: loadPost,
      key: ["post", "hello"],
      scope: "request",
    } as const;

    await expect(cache.get(request)).resolves.toBe("post");
    await expect(cache.get(request)).resolves.toBe("post");

    expect(loadPost).toHaveBeenCalledTimes(1);
  });

  it("shares public cache work until TTL expiry", async () => {
    let now = 0;
    const cache = createMemoryCache({ now: () => now });
    const loadPost = vi.fn(async () => `post-${loadPost.mock.calls.length}`);
    const request = {
      fn: loadPost,
      key: ["post", "hello"],
      scope: "public",
      ttl: "1s",
    } as const;

    await expect(cache.get(request)).resolves.toBe("post-1");
    await expect(cache.get(request)).resolves.toBe("post-1");

    now = 1_001;

    await expect(cache.get(request)).resolves.toBe("post-2");
    expect(loadPost).toHaveBeenCalledTimes(2);
  });

  it("serves stale values while one cache instance refreshes in the background", async () => {
    let now = 0;
    const store = createMemoryCacheStore({ now: () => now });
    const background: Promise<void>[] = [];
    const options = {
      namespace: { app: "catalog", environment: "test", schemaVersion: 1 },
      now: () => now,
      store,
      waitUntil: (promise: Promise<void>) => background.push(promise),
    } as const;
    const firstCache = createCache(options);
    const secondCache = createCache(options);
    const refresh = deferred<string>();
    const loadPost = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("post-1")
      .mockImplementation(() => refresh.promise);
    const request = {
      fn: loadPost,
      key: ["post", "hello"],
      scope: "public",
      staleWhileRevalidate: 20,
      ttl: 10,
    } as const;

    await expect(firstCache.get(request)).resolves.toBe("post-1");
    now = 11;

    await expect(firstCache.get(request)).resolves.toBe("post-1");
    await expect(secondCache.get(request)).resolves.toBe("post-1");
    expect(loadPost).toHaveBeenCalledTimes(2);
    expect(background).toHaveLength(1);

    refresh.resolve("post-2");
    await Promise.all(background);
    await expect(secondCache.get(request)).resolves.toBe("post-2");
  });

  it("retains stale data and reports background refresh failures", async () => {
    let now = 0;
    const background: Promise<void>[] = [];
    const errors: unknown[] = [];
    const cache = createMemoryCache({
      now: () => now,
      onBackgroundError: (error) => errors.push(error),
      waitUntil: (promise) => background.push(promise),
    });
    const failure = new Error("upstream unavailable");
    const loadPost = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("post-1")
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce("post-2");
    const request = {
      fn: loadPost,
      key: ["post", "hello"],
      scope: "public",
      staleWhileRevalidate: 20,
      ttl: 10,
    } as const;

    await expect(cache.get(request)).resolves.toBe("post-1");
    now = 11;
    await expect(cache.get(request)).resolves.toBe("post-1");
    await Promise.all(background.splice(0));
    expect(errors).toEqual([failure]);

    await expect(cache.get(request)).resolves.toBe("post-1");
    await Promise.all(background);
    await expect(cache.get(request)).resolves.toBe("post-2");
  });

  it("does not publish a stale refresh after key invalidation", async () => {
    let now = 0;
    const background: Promise<void>[] = [];
    const cache = createMemoryCache({
      now: () => now,
      waitUntil: (promise) => background.push(promise),
    });
    const refresh = deferred<string>();
    const loadPost = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("post-1")
      .mockImplementationOnce(() => refresh.promise)
      .mockResolvedValueOnce("post-3");
    const request = {
      fn: loadPost,
      key: ["post", "hello"],
      scope: "public",
      staleWhileRevalidate: 20,
      ttl: 10,
    } as const;

    await cache.get(request);
    now = 11;
    await expect(cache.get(request)).resolves.toBe("post-1");
    await expect(cache.invalidateKey(request.key)).resolves.toBe(true);
    refresh.resolve("post-2");
    await Promise.all(background);

    await expect(cache.get(request)).resolves.toBe("post-3");
  });

  it("blocks for a new value after the stale window expires", async () => {
    let now = 0;
    const cache = createMemoryCache({ now: () => now });
    const loadPost = vi.fn(async () => `post-${loadPost.mock.calls.length}`);
    const request = {
      fn: loadPost,
      key: ["post", "hello"],
      scope: "public",
      staleWhileRevalidate: 20,
      ttl: 10,
    } as const;

    await expect(cache.get(request)).resolves.toBe("post-1");
    now = 31;
    await expect(cache.get(request)).resolves.toBe("post-2");
    expect(loadPost).toHaveBeenCalledTimes(2);
  });

  it("requires explicit store coordination when stale serving is used", async () => {
    let now = 0;
    const memory = createMemoryCacheStore({ now: () => now });
    const store = {
      delete: memory.delete,
      get: memory.get,
      invalidateTags: memory.invalidateTags,
      set: memory.set,
    };
    const cache = createCache({
      namespace: { app: "catalog", environment: "test", schemaVersion: 1 },
      now: () => now,
      store,
    });
    const request = {
      fn: async () => "post",
      key: ["post"],
      scope: "public",
      staleWhileRevalidate: 20,
      ttl: 10,
    } as const;

    await cache.get(request);
    now = 11;
    await expect(cache.get(request)).rejects.toThrow(
      "staleWhileRevalidate requires a cache store",
    );
  });

  it("requires a finite ttl for stale-while-revalidate", async () => {
    const cache = createMemoryCache();

    await expect(
      cache.get({
        fn: async () => "post",
        key: ["post"],
        scope: "public",
        staleWhileRevalidate: "1m",
      }),
    ).rejects.toThrow("staleWhileRevalidate requires a finite cache ttl");
  });

  it("does not cache none-scoped work", async () => {
    const cache = createMemoryCache();
    const loadPost = vi.fn(async () => `post-${loadPost.mock.calls.length}`);
    const request = {
      fn: loadPost,
      key: ["post", "hello"],
      scope: "none",
    } as const;

    await expect(cache.get(request)).resolves.toBe("post-1");
    await expect(cache.get(request)).resolves.toBe("post-2");
    expect(loadPost).toHaveBeenCalledTimes(2);
  });

  it("invalidates cached entries by key and tag", async () => {
    const cache = createMemoryCache();
    const loadPost = vi.fn(async () => `post-${loadPost.mock.calls.length}`);
    const request = {
      fn: loadPost,
      key: ["post", "hello"],
      scope: "public",
      tags: [tag("posts"), tag("post:hello")],
    } as const;

    await expect(cache.get(request)).resolves.toBe("post-1");
    await expect(cache.invalidateTags([tag("posts")])).resolves.toBe(1);
    await expect(cache.get(request)).resolves.toBe("post-2");
    await expect(cache.invalidateKey(["post", "hello"])).resolves.toBe(true);
    await expect(cache.get(request)).resolves.toBe("post-3");
  });

  it("caches a negative result and re-throws it on subsequent shared hits", async () => {
    let now = 0;
    const cache = createMemoryCache({ now: () => now });
    const loadPost = vi.fn(async () => cacheNotFound("no such post"));
    const request = {
      fn: loadPost,
      key: ["post", "missing"],
      notFoundTtl: "1s",
      scope: "public",
      ttl: "1h",
    } as const;

    await expect(cache.get(request)).rejects.toThrow(CacheNotFoundError);
    await expect(cache.get(request)).rejects.toThrow("no such post");
    expect(loadPost).toHaveBeenCalledTimes(1);

    now = 1_001;

    await expect(cache.get(request)).rejects.toThrow(CacheNotFoundError);
    expect(loadPost).toHaveBeenCalledTimes(2);
  });

  it("caches a negative result and re-throws it on subsequent request-scoped hits", async () => {
    let now = 0;
    const cache = createMemoryCache({ now: () => now });
    const loadPost = vi.fn(async () => cacheNotFound());
    const request = {
      fn: loadPost,
      key: ["post", "missing"],
      notFoundTtl: "1s",
      scope: "request",
      ttl: "1h",
    } as const;

    await expect(cache.get(request)).rejects.toSatisfy(isCacheNotFoundError);
    await expect(cache.get(request)).rejects.toSatisfy(isCacheNotFoundError);
    expect(loadPost).toHaveBeenCalledTimes(1);

    now = 1_001;

    await expect(cache.get(request)).rejects.toSatisfy(isCacheNotFoundError);
    expect(loadPost).toHaveBeenCalledTimes(2);
  });

  it("invalidates a negative entry by tag the same as a positive one", async () => {
    const cache = createMemoryCache();
    const loadPost = vi.fn(async () => cacheNotFound());
    const request = {
      fn: loadPost,
      key: ["post", "missing"],
      notFoundTtl: "1h",
      scope: "public",
      tags: [tag("posts")],
    } as const;

    await expect(cache.get(request)).rejects.toThrow(CacheNotFoundError);
    await expect(cache.invalidateTags([tag("posts")])).resolves.toBe(1);
    await expect(cache.get(request)).rejects.toThrow(CacheNotFoundError);
    expect(loadPost).toHaveBeenCalledTimes(2);
  });

  it("propagates an error that is not a negative-result signal without caching it", async () => {
    const cache = createMemoryCache();
    const loadPost = vi.fn(async () => {
      throw new Error("boom");
    });
    const request = {
      fn: loadPost,
      key: ["post", "broken"],
      notFoundTtl: "1h",
      scope: "public",
    } as const;

    await expect(cache.get(request)).rejects.toThrow("boom");
    await expect(cache.get(request)).rejects.toThrow("boom");
    expect(loadPost).toHaveBeenCalledTimes(2);
  });

  it("creates framework-owned invalidation helpers over a cache", async () => {
    const cache = createMemoryCache();
    const invalidate = createInvalidation(cache);
    const loadPost = vi.fn(async () => `post-${loadPost.mock.calls.length}`);
    const loadAuthor = vi.fn(async () => `author-${loadAuthor.mock.calls.length}`);

    await cache.get({
      fn: loadPost,
      key: ["post", "hello"],
      scope: "public",
      tags: [tag("posts"), tag("post:hello")],
    });
    await cache.get({
      fn: loadAuthor,
      key: ["author", "ada"],
      scope: "public",
      tags: [tag("authors")],
    });

    await expect(invalidate.key(["missing"])).resolves.toEqual({
      deleted: 0,
      kind: "key",
    });
    await expect(invalidate.tag(tag("posts"))).resolves.toEqual({
      deleted: 1,
      kind: "tag",
    });
    await expect(
      invalidate.keys([["author", "ada"], ["missing"]]),
    ).resolves.toEqual({
      deleted: 1,
      kind: "key",
    });

    await cache.get({
      fn: loadPost,
      key: ["post", "hello"],
      scope: "public",
      tags: [tag("posts"), tag("post:hello")],
    });
    await cache.get({
      fn: loadAuthor,
      key: ["author", "ada"],
      scope: "public",
      tags: [tag("authors")],
    });

    await expect(
      invalidate.tags([tag("posts"), tag("authors")]),
    ).resolves.toEqual({
      deleted: 2,
      kind: "tag",
    });
    expect(loadPost).toHaveBeenCalledTimes(2);
    expect(loadAuthor).toHaveBeenCalledTimes(2);
  });

  it("isolates shared entries by namespace and scope", async () => {
    const store = createMemoryCacheStore();
    const production = createCache({
      namespace: { app: "catalog", environment: "production", schemaVersion: 3 },
      store,
    });
    const staging = createCache({
      namespace: { app: "catalog", environment: "staging", schemaVersion: 3 },
      store,
    });
    const load = vi.fn(async (value: string) => value);

    for (const scope of ["build", "private", "public"] as const) {
      await expect(
        production.get({ fn: () => load(`production-${scope}`), key: ["same"], scope }),
      ).resolves.toBe(`production-${scope}`);
      await expect(
        staging.get({ fn: () => load(`staging-${scope}`), key: ["same"], scope }),
      ).resolves.toBe(`staging-${scope}`);
    }

    expect(load).toHaveBeenCalledTimes(6);
    await expect(
      production.get({ fn: () => load("miss"), key: ["same"], scope: "public" }),
    ).resolves.toBe("production-public");
    expect(load).toHaveBeenCalledTimes(6);
  });

  it("keeps request and none scopes out of a shared store", async () => {
    const entries = new Map();
    const store = createMemoryCacheStore({ entries });
    const options = {
      namespace: { app: "catalog", environment: "test", schemaVersion: 1 },
      store,
    } as const;
    const firstRequest = createCache(options);
    const secondRequest = createCache(options);
    const requestLoad = vi.fn(async () => `request-${requestLoad.mock.calls.length}`);
    const noneLoad = vi.fn(async () => `none-${noneLoad.mock.calls.length}`);
    const request = { fn: requestLoad, key: ["item"], scope: "request" } as const;
    const none = { fn: noneLoad, key: ["item"], scope: "none" } as const;

    await expect(firstRequest.get(request)).resolves.toBe("request-1");
    await expect(firstRequest.get(request)).resolves.toBe("request-1");
    await expect(secondRequest.get(request)).resolves.toBe("request-2");
    await expect(firstRequest.get(none)).resolves.toBe("none-1");
    await expect(firstRequest.get(none)).resolves.toBe("none-2");

    expect(entries.size).toBe(0);
  });

  it("sends fully namespaced keys and tags to the store", async () => {
    const entries = new Map();
    const cache = createCache({
      namespace: { app: "catalog", environment: "production", schemaVersion: 2 },
      store: createMemoryCacheStore({ entries }),
    });

    await cache.get({
      fn: () => ({ title: "Hello" }),
      key: ["post", { slug: "hello" }],
      scope: "public",
      tags: [tag("posts"), tag("post:hello")],
    });

    expect([...entries]).toEqual([
      [
        'catalog:production:2:public:key:["post",{"slug":"hello"}]',
        {
          expiresAt: null,
          staleUntil: null,
          tags: [
            "catalog:production:2:public:tag:posts",
            "catalog:production:2:public:tag:post:hello",
          ],
          value: { title: "Hello" },
        },
      ],
    ]);
  });

  it("does not let pending work repopulate an invalidated shared tag", async () => {
    const entries = new Map();
    const store = createMemoryCacheStore({ entries });
    const cache = createCache({
      namespace: { app: "catalog", environment: "test", schemaVersion: 1 },
      store,
    });
    const result = deferred<string>();
    const pending = cache.get({
      fn: () => result.promise,
      key: ["post", "hello"],
      scope: "public",
      tags: [tag("posts")],
    });

    await Promise.resolve();
    await expect(cache.invalidateTags([tag("posts")])).resolves.toBe(1);
    result.resolve("stale");
    await expect(pending).resolves.toBe("stale");

    const nextCache = createCache({
      namespace: { app: "catalog", environment: "test", schemaVersion: 1 },
      store,
    });
    await expect(
      nextCache.get({
        fn: () => "fresh",
        key: ["post", "hello"],
        scope: "public",
      }),
    ).resolves.toBe("fresh");
  });

  it("serializes and validates cache namespaces", () => {
    expect(
      serializeCacheNamespace({
        app: "catalog",
        environment: "production",
        schemaVersion: "v2",
      }),
    ).toBe("catalog:production:v2");
    expect(() =>
      serializeCacheNamespace({
        app: "catalog:other",
        environment: "production",
        schemaVersion: 1,
      })
    ).toThrow(/namespace app/);
    expect(() =>
      serializeCacheNamespace({
        app: "catalog",
        environment: "production",
        schemaVersion: -1,
      })
    ).toThrow(/schemaVersion/);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}
