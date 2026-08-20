import type { CacheStore } from "./cache";

export type TieredCacheStoreOptions = {
  // The per-process layer. Reads hit this first; writes populate it last so
  // a caller never observes a value in `l1` before it is durable in `l2`.
  l1: CacheStore;
  // The shared, source-of-truth layer other replicas also read and write.
  // `acquireRefreshLease` delegates here exclusively, since lease
  // coordination across replicas only means anything at the layer they all
  // share.
  l2: CacheStore;
};

// Layers any two `CacheStore` implementations into one `CacheStore`. The
// combinator does not know or care which concrete stores it wraps: `l1` is
// typically a per-process store (e.g. `createMemoryCacheStore`) and `l2` a
// shared one (e.g. `createRedisCacheStore`/`createKvCacheStore`), but any
// pair works, including two shared stores.
//
// Staleness trade-off: because `l1` is local to one process, a write or tag
// invalidation issued against `l2` by another replica is invisible to this
// process's `l1` until that key's own TTL/staleUntil expires it out of
// `l1` locally. This process keeps serving its last-known `l1` value for
// that key in the meantime. This is the same category of caveat already
// documented on the KV store for its own eventual consistency: correctness
// here comes from `l2` remaining the source of truth and every write path
// going through it, not from `l1` staying perfectly in sync.
export function createTieredCacheStore(
  options: TieredCacheStoreOptions,
): CacheStore {
  const { l1, l2 } = options;

  return {
    async acquireRefreshLease(key, token, expiresAt) {
      if (!l2.acquireRefreshLease) {
        throw new Error(
          "Demiurge tiered cache store requires l2 to support acquireRefreshLease for staleWhileRevalidate.",
        );
      }

      return await l2.acquireRefreshLease(key, token, expiresAt);
    },
    async delete(key) {
      const deletedFromL2 = await l2.delete(key);
      const deletedFromL1 = await l1.delete(key);

      return deletedFromL2 || deletedFromL1;
    },
    async get(key) {
      const l1Entry = await l1.get(key);

      if (l1Entry !== undefined) {
        return l1Entry;
      }

      const l2Entry = await l2.get(key);

      if (l2Entry !== undefined) {
        await l1.set(key, l2Entry);
      }

      return l2Entry;
    },
    async invalidateTags(tags) {
      const deletedFromL2 = await l2.invalidateTags(tags);
      await l1.invalidateTags(tags);

      return deletedFromL2;
    },
    async publishRefresh(key, token, entry) {
      if (!l2.publishRefresh) {
        throw new Error(
          "Demiurge tiered cache store requires l2 to support publishRefresh for staleWhileRevalidate.",
        );
      }

      const published = await l2.publishRefresh(key, token, entry);

      if (published) {
        await l1.set(key, entry);
      }

      return published;
    },
    async releaseRefreshLease(key, token) {
      if (!l2.releaseRefreshLease) {
        throw new Error(
          "Demiurge tiered cache store requires l2 to support releaseRefreshLease for staleWhileRevalidate.",
        );
      }

      await l2.releaseRefreshLease(key, token);
    },
    async set(key, entry) {
      await l2.set(key, entry);
      await l1.set(key, entry);
    },
  };
}
