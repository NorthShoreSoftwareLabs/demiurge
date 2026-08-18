import { describe, expect, it } from "vitest";
import {
  createUnavailableCacheStore,
  createUnavailableRateLimitStore,
  EdgeSharedStoreError,
} from "@demiurgejs/core/edge";

describe("createUnavailableCacheStore", () => {
  const store = createUnavailableCacheStore();
  const entry = {
    expiresAt: null,
    staleUntil: null,
    tags: [],
    value: "refused",
  };

  const operations = {
    acquireRefreshLease: () => store.acquireRefreshLease!("key", "token", 1),
    delete: () => store.delete("key"),
    get: () => store.get("key"),
    invalidateTags: () => store.invalidateTags(["tag"]),
    publishRefresh: () => store.publishRefresh!("key", "token", entry),
    releaseRefreshLease: () => store.releaseRefreshLease!("key", "token"),
    set: () => store.set("key", entry),
  };

  for (const [name, operation] of Object.entries(operations)) {
    it(`refuses ${name} instead of caching per isolate`, () => {
      expect(operation).toThrow(EdgeSharedStoreError);
      expect(operation).toThrow(/no shared cache store/);
    });
  }
});

describe("createUnavailableRateLimitStore", () => {
  it("refuses to count instead of counting per isolate", () => {
    const store = createUnavailableRateLimitStore();

    expect(() => store.increment("ip:203.0.113.7", 1_000, 0)).toThrow(
      EdgeSharedStoreError,
    );
    expect(() => store.increment("ip:203.0.113.7", 1_000, 0)).toThrow(
      /no shared rate limit store/,
    );
  });
});
