import type { CacheStore } from "../data/cache";
import type { RateLimitStore } from "../security/types";

// An edge deployment runs many isolates, and an isolate keeps its memory to
// itself. An in-memory store therefore counts one client in several buckets
// and caches one value several times. That reads as a working store and is not
// one. These stores refuse the operation instead.
export class EdgeSharedStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EdgeSharedStoreError";
  }
}

const cacheStoreMessage =
  'Demiurge edge deployments have no shared cache store. This handler declares cacheStore "unavailable", so a "build", "private", or "public" cache scope cannot run. Pass a shared CacheStore, or keep the cache scope at "request".';

const rateLimitStoreMessage =
  'Demiurge edge deployments have no shared rate limit store. This handler declares rateLimitStore "unavailable", so a rate limit policy cannot be enforced. Pass a shared RateLimitStore, or remove the rate limit policy.';

export function createUnavailableCacheStore(): CacheStore {
  const refuse = (): never => {
    throw new EdgeSharedStoreError(cacheStoreMessage);
  };

  return {
    acquireRefreshLease: refuse,
    delete: refuse,
    get: refuse,
    invalidateTags: refuse,
    publishRefresh: refuse,
    releaseRefreshLease: refuse,
    set: refuse,
  };
}

export function createUnavailableRateLimitStore(): RateLimitStore {
  return {
    increment() {
      throw new EdgeSharedStoreError(rateLimitStoreMessage);
    },
  };
}
