import { describe, expect, it, vi } from "vitest";
import {
  createInvalidation,
  createMemoryCache,
  defineTags,
  parseCacheDuration,
  query,
  serializeCacheKey,
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
    expect(cache.invalidateTags([tag("posts")])).toBe(1);
    await expect(cache.get(request)).resolves.toBe("post-2");
    expect(cache.invalidateKey(["post", "hello"])).toBe(true);
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

    expect(invalidate.key(["missing"])).toEqual({
      deleted: 0,
      kind: "key",
    });
    expect(invalidate.tag(tag("posts"))).toEqual({
      deleted: 1,
      kind: "tag",
    });
    expect(invalidate.keys([["author", "ada"], ["missing"]])).toEqual({
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

    expect(invalidate.tags([tag("posts"), tag("authors")])).toEqual({
      deleted: 2,
      kind: "tag",
    });
    expect(loadPost).toHaveBeenCalledTimes(2);
    expect(loadAuthor).toHaveBeenCalledTimes(2);
  });
});
