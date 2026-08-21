import type { CacheStore, CacheStoreEntry } from "../data/cache";

// This type documents the interface an adapter FOR a KV store needs, not a
// dependency on any vendor SDK. It is modeled closely on the binding API
// Cloudflare Workers KV exposes, because that shape is the one most other
// edge KV providers already copy. The application supplies its own
// connected client matching this interface, the same way
// `createRedisCacheStore` takes a connected `ioredis` client rather than
// owning the connection. A Deno KV or Vercel Edge Config client can satisfy
// this interface with a small wrapper even when its native method names
// differ.
export type EdgeKvListKey = {
  name: string;
};

export type EdgeKvListResult = {
  cursor?: string;
  keys: readonly EdgeKvListKey[];
  list_complete: boolean;
};

export type EdgeKvPutOptions = {
  // Absolute expiration, in seconds since the Unix epoch. This store always
  // uses `expiration` rather than `expirationTtl` so an entry's lifetime
  // tracks its `staleUntil` timestamp exactly. Redis gets the same result
  // with `PEXPIREAT` instead of a relative `PEXPIRE`.
  expiration?: number;
};

export type EdgeKvNamespace = {
  delete: (key: string) => Promise<void>;
  get: (key: string) => Promise<string | null>;
  list: (options?: {
    cursor?: string;
    limit?: number;
    prefix?: string;
  }) => Promise<EdgeKvListResult>;
  put: (key: string, value: string, options?: EdgeKvPutOptions) => Promise<void>;
};

export type KvCacheStoreOptions = {
  // Every consumer of one KV namespace shares one keyspace. This prefix
  // scopes the store's entry, tag, and lease keys away from an
  // application's other use of the same namespace. Two Demiurge
  // deployments that share a namespace still need distinct prefixes, the
  // same way they need distinct cache namespaces.
  keyPrefix?: string;
  // The store issues operations on a client the application already
  // constructed and bound. Which provider, region, and namespace ID back
  // it is the application's decision, not this store's.
  namespace: EdgeKvNamespace;
};

const defaultKeyPrefix = "demiurge:cache:";
const listPageLimit = 1000;

// KV stores give up two things Redis's Lua scripts provided: cross-key
// atomicity and a compare-and-swap primitive. Every write below is
// therefore several sequential operations rather than one atomic script.
//
// Concretely, `set()`, `delete()`, and `publishRefresh()` each read the
// previous entry, then write tag membership changes and the entry itself as
// separate operations. A reader racing with one of these calls can briefly
// see an entry whose tag memberships have not finished updating. It can
// also see a tag membership entry whose backing cache entry is already
// gone. `invalidateTags()` tolerates the latter case. It treats a
// membership entry with no backing cache entry as already invalid and
// simply removes it.
//
// `acquireRefreshLease()` and `publishRefresh()` implement single-writer
// coordination with a get-then-write pattern, not a real compare-and-swap.
// Two isolates that call `acquireRefreshLease()` within the same
// observation window can both see no lease and both write one. The worst
// case is redundant refresh work, the same failure mode
// `staleWhileRevalidate` already tolerates when no coordination exists at
// all. Do not rely on this store for exclusive-execution correctness
// beyond that. The Redis store's atomic Lua scripts give a stronger
// guarantee where that matters.
//
// Tag invalidation lists membership keys by prefix and deletes each
// matching entry. `list()` on a real KV store is typically eventually
// consistent. A membership entry written just before a matching `list()`
// call may not appear on that call. A store that needs read-your-writes
// tag invalidation should use the Redis store instead.
export function createKvCacheStore(options: KvCacheStoreOptions): CacheStore {
  if (!options.namespace || typeof options.namespace.get !== "function") {
    throw new Error(
      "Demiurge KV cache store requires an EdgeKvNamespace. Pass a connected KV client matching the get/put/delete/list interface documented on EdgeKvNamespace.",
    );
  }

  const kv = options.namespace;
  const prefix = options.keyPrefix ?? defaultKeyPrefix;
  const entryPrefix = `${prefix}entry:`;
  const tagPrefix = `${prefix}tag:`;
  const leasePrefix = `${prefix}lease:`;

  function entryKey(key: string) {
    return entryPrefix + key;
  }

  function leaseKey(key: string) {
    return leasePrefix + key;
  }

  function tagMemberKey(tagId: string, key: string) {
    return `${tagPrefix}${tagId}:${key}`;
  }

  async function readEntry(key: string): Promise<CacheStoreEntry | undefined> {
    const raw = await kv.get(entryKey(key));
    // TYPE-EVIDENCE: the stored raw value is JSON that the store serialized from a cache entry. The cast restores that shape.
    return raw ? (JSON.parse(raw) as CacheStoreEntry) : undefined;
  }

  async function removeTagMemberships(key: string, tags: readonly string[]) {
    await Promise.all(
      tags.map((tagId) => kv.delete(tagMemberKey(tagId, key))),
    );
  }

  async function addTagMemberships(
    key: string,
    tags: readonly string[],
    expiration: number | undefined,
  ) {
    await Promise.all(
      tags.map((tagId) =>
        kv.put(tagMemberKey(tagId, key), "1", { expiration })
      ),
    );
  }

  async function writeEntry(key: string, entry: CacheStoreEntry) {
    const previous = await readEntry(key);

    if (previous) {
      await removeTagMemberships(key, previous.tags);
    }

    const expiration = entryExpiration(entry);
    await kv.put(entryKey(key), JSON.stringify(entry), { expiration });
    await addTagMemberships(key, entry.tags, expiration);
  }

  return {
    async acquireRefreshLease(key, token, expiresAt) {
      const existing = await kv.get(leaseKey(key));

      if (existing) {
        return false;
      }

      await kv.put(leaseKey(key), token, {
        expiration: toExpirationSeconds(expiresAt),
      });

      return true;
    },
    async delete(key) {
      const previous = await readEntry(key);
      await kv.delete(leaseKey(key));

      if (!previous) {
        return false;
      }

      await removeTagMemberships(key, previous.tags);
      await kv.delete(entryKey(key));

      return true;
    },
    async get(key) {
      return await readEntry(key);
    },
    async invalidateTags(tags) {
      if (tags.length === 0) {
        return 0;
      }

      const seen = new Set<string>();
      let deleted = 0;

      for (const tagId of tags) {
        const membershipPrefix = tagMemberKey(tagId, "");
        let cursor: string | undefined;

        do {
          const page = await kv.list({
            cursor,
            limit: listPageLimit,
            prefix: membershipPrefix,
          });

          for (const listedKey of page.keys) {
            const rawKey = listedKey.name.slice(membershipPrefix.length);

            if (seen.has(rawKey)) {
              continue;
            }

            seen.add(rawKey);

            const entry = await readEntry(rawKey);

            if (!entry) {
              await kv.delete(listedKey.name);
              continue;
            }

            await removeTagMemberships(rawKey, entry.tags);
            await kv.delete(entryKey(rawKey));
            await kv.delete(leaseKey(rawKey));
            deleted += 1;
          }

          cursor = page.list_complete ? undefined : page.cursor;
        } while (cursor);
      }

      return deleted;
    },
    async publishRefresh(key, token, entry) {
      const owner = await kv.get(leaseKey(key));

      if (owner !== token) {
        return false;
      }

      await writeEntry(key, entry);
      await kv.delete(leaseKey(key));

      return true;
    },
    async releaseRefreshLease(key, token) {
      const owner = await kv.get(leaseKey(key));

      if (owner === token) {
        await kv.delete(leaseKey(key));
      }
    },
    async set(key, entry) {
      await writeEntry(key, entry);
      await kv.delete(leaseKey(key));
    },
  };
}

function entryExpiration(entry: CacheStoreEntry) {
  return entry.staleUntil === null
    ? undefined
    : toExpirationSeconds(entry.staleUntil);
}

function toExpirationSeconds(epochMilliseconds: number) {
  return Math.ceil(epochMilliseconds / 1000);
}
