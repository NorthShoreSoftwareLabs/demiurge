import { describe, expect, it } from "vitest";
import { createKvCacheStore } from "@demiurgejs/core/kv";
import {
  verifyCacheStoreContract,
  verifyCacheStoreRefreshContract,
} from "../../src/data/testing";
import type { CacheStoreEntry } from "../../src/data/cache";
import { createFakeKvNamespace } from "./fake-kv-namespace";

describe("createKvCacheStore", () => {
  it("satisfies the cache store contract", async () => {
    await expect(
      verifyCacheStoreContract(() =>
        createKvCacheStore({ namespace: createFakeKvNamespace() })
      ),
    ).resolves.toBeUndefined();
  });

  it("satisfies the atomic stale-refresh contract", async () => {
    await expect(
      verifyCacheStoreRefreshContract(() =>
        createKvCacheStore({ namespace: createFakeKvNamespace() })
      ),
    ).resolves.toBeUndefined();
  });

  it("scopes entry, tag, and lease keys under keyPrefix", async () => {
    const namespace = createFakeKvNamespace();
    const store = createKvCacheStore({ keyPrefix: "app:cache:", namespace });
    const future = Date.now() + 60_000;
    const entry: CacheStoreEntry = {
      expiresAt: future,
      staleUntil: future + 5_000,
      tags: ["posts"],
      value: { title: "scoped" },
    };

    await store.set("post:1", entry);
    expect(await namespace.get("app:cache:entry:post:1")).toBe(
      JSON.stringify(entry),
    );
    expect(await namespace.get("app:cache:tag:posts:post:1")).toBe("1");
  });

  it("uses the default key prefix when none is given", async () => {
    const namespace = createFakeKvNamespace();
    const store = createKvCacheStore({ namespace });
    const entry: CacheStoreEntry = {
      expiresAt: null,
      staleUntil: null,
      tags: [],
      value: "default-prefix",
    };

    await store.set("default-prefix-check", entry);
    expect(await namespace.get("demiurge:cache:entry:default-prefix-check"))
      .toBe(JSON.stringify(entry));
  });

  it("removes stale tag membership entries with no backing cache entry", async () => {
    const namespace = createFakeKvNamespace();
    const store = createKvCacheStore({
      keyPrefix: "orphan:",
      namespace,
    });

    // Simulate a membership entry left behind after its backing cache entry
    // expired independently (KV entries can expire on their own schedule).
    await namespace.put("orphan:tag:posts:ghost", "1");

    expect(await store.invalidateTags(["posts"])).toBe(0);
    expect(await namespace.get("orphan:tag:posts:ghost")).toBeNull();
  });

  it("does not delete an entry whose tags no longer include the invalidated tag", async () => {
    const namespace = createFakeKvNamespace();
    const store = createKvCacheStore({ keyPrefix: "retag:", namespace });
    const future = Date.now() + 60_000;

    await store.set("post:1", {
      expiresAt: future,
      staleUntil: future + 5_000,
      tags: ["posts"],
      value: "v1",
    });
    await store.set("post:1", {
      expiresAt: future,
      staleUntil: future + 5_000,
      tags: ["drafts"],
      value: "v2",
    });

    expect(await store.invalidateTags(["posts"])).toBe(0);
    expect((await store.get("post:1"))?.value).toBe("v2");
  });

  it("paginates invalidateTags across multiple list pages", async () => {
    const namespace = createFakeKvNamespace();
    const store = createKvCacheStore({ keyPrefix: "page:", namespace });
    const future = Date.now() + 60_000;
    const keys = Array.from({ length: 5 }, (_value, index) => `post:${index}`);

    for (const key of keys) {
      await store.set(key, {
        expiresAt: future,
        staleUntil: future + 5_000,
        tags: ["posts"],
        value: key,
      });
    }

    // A tiny list page size forces invalidateTags() through several list()
    // calls instead of one, exercising the cursor loop.
    const smallPageNamespace = wrapWithListLimit(namespace, 2);
    const smallPageStore = createKvCacheStore({
      keyPrefix: "page:",
      namespace: smallPageNamespace,
    });

    expect(await smallPageStore.invalidateTags(["posts"])).toBe(5);

    for (const key of keys) {
      expect(await store.get(key)).toBeUndefined();
    }
  });
});

describe("createKvCacheStore without a namespace", () => {
  it("throws a clear error instead of caching silently", () => {
    expect(() =>
      createKvCacheStore(
        // @ts-expect-error deliberately omitting the required namespace
        { keyPrefix: "test:" },
      )
    ).toThrow(
      "Demiurge KV cache store requires an EdgeKvNamespace. Pass a connected KV client matching the get/put/delete/list interface documented on EdgeKvNamespace.",
    );
  });
});

function wrapWithListLimit(
  namespace: ReturnType<typeof createFakeKvNamespace>,
  limit: number,
): ReturnType<typeof createFakeKvNamespace> {
  return {
    ...namespace,
    list: (options = {}) => namespace.list({ ...options, limit }),
  };
}
