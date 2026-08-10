import { describe, expect, it, vi } from "vitest";
import {
  createCache,
  createInvalidation,
  createMemoryCache,
  createMemoryCacheStore,
  defineTags,
  parseCacheDuration,
  query,
  serializeCacheKey,
  serializeCacheNamespace,
  tag,
} from "demiurge";

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
      tags: (slug) => [tags.posts(), tags.post({ slug })],
      ttl: "10m",
    });
    const request = postBySlug("hello-world");

    expect(request.key).toEqual(["post", { slug: "hello-world" }]);
    expect(request.scope).toBe("public");
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

  it("parses cache durations", () => {
    expect(parseCacheDuration(undefined)).toBe(Number.POSITIVE_INFINITY);
    expect(parseCacheDuration(250)).toBe(250);
    expect(parseCacheDuration("250ms")).toBe(250);
    expect(parseCacheDuration("2s")).toBe(2_000);
    expect(parseCacheDuration("3m")).toBe(180_000);
    expect(parseCacheDuration("4h")).toBe(14_400_000);
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
