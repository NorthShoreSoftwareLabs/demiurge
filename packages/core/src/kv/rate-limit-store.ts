import type { RateLimitStore } from "../security/types";
import type { EdgeKvNamespace } from "./store";

export type KvRateLimitStoreOptions = {
  // Every consumer of one KV namespace shares one keyspace. This prefix
  // scopes the store's counter keys away from an application's other use of
  // the same namespace, the same way `KvCacheStoreOptions.keyPrefix` scopes
  // `createKvCacheStore`'s keys.
  keyPrefix?: string;
  // The store issues operations on a client the application already
  // constructed and bound. Which provider, region, and namespace ID back
  // it is the application's decision, not this store's.
  namespace: EdgeKvNamespace;
};

type KvRateLimitEntry = {
  count: number;
  resetAt: number;
};

const defaultKeyPrefix = "demiurge:rate-limit:";

// KV gives up the same thing here that `createKvCacheStore` gives up:
// cross-operation atomicity. Plain KV has no compare-and-swap, so
// `increment()` is necessarily a get-then-write, not a single atomic
// operation. Two requests that call `increment()` within the same
// observation window can both read the same prior count. Both then write
// `count + 1`, so one increment is lost. The store can therefore undercount
// under concurrent requests in that narrow window. It cannot overcount, and
// it never blocks a request that should have been limited by more than one
// request's worth of slack. Treat this as a soft limiter suitable for
// coarse abuse protection, not an exact one. The Redis store's atomic Lua
// script gives a stronger guarantee where that matters.
export function createKvRateLimitStore(
  options: KvRateLimitStoreOptions,
): RateLimitStore {
  if (!options.namespace || typeof options.namespace.get !== "function") {
    throw new Error(
      "Demiurge KV rate limit store requires an EdgeKvNamespace. Pass a connected KV client matching the get/put/delete/list interface documented on EdgeKvNamespace.",
    );
  }

  const kv = options.namespace;
  const prefix = options.keyPrefix ?? defaultKeyPrefix;

  function counterKey(key: string) {
    return `${prefix}${key}`;
  }

  return {
    async increment(key, windowMs, now) {
      const storeKey = counterKey(key);
      const raw = await kv.get(storeKey);
      // TYPE-EVIDENCE: the stored raw value is JSON that the store serialized as a rate limit entry. The cast restores that shape.
      const existing = raw ? (JSON.parse(raw) as KvRateLimitEntry) : undefined;

      const next: KvRateLimitEntry = !existing || existing.resetAt <= now
        ? { count: 1, resetAt: now + windowMs }
        : { count: existing.count + 1, resetAt: existing.resetAt };

      await kv.put(storeKey, JSON.stringify(next), {
        expiration: toExpirationSeconds(next.resetAt),
      });

      return next;
    },
  };
}

function toExpirationSeconds(epochMilliseconds: number) {
  return Math.ceil(epochMilliseconds / 1000);
}
