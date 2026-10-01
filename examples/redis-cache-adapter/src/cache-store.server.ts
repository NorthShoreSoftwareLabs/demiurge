import "@demiurgejs/core/server-only";
import type { CacheStore, CacheStoreEntry } from "@demiurgejs/core";

const entryPrefix = "demiurge-example:entry:";

export type ApplicationRedisClient = {
  del: (...keys: string[]) => Promise<number>;
  get: (key: string) => Promise<null | string>;
  mget: (keys: string[]) => Promise<(null | string)[]>;
  scan: (
    cursor: string,
    match: "MATCH",
    pattern: string,
    count: "COUNT",
    limit: number,
  ) => Promise<[string, string[]]>;
  set: (key: string, value: string) => Promise<unknown>;
};

export function createApplicationRedisStore(client: ApplicationRedisClient): CacheStore {
  return {
    capabilities: { atomicity: "best-effort" },
    async delete(key) {
      return await client.del(entryPrefix + key) === 1;
    },
    async get(key) {
      const value = await client.get(entryPrefix + key);
      // TYPE-EVIDENCE: this store writes only serialized CacheStoreEntry values under its entry prefix.
      return value ? JSON.parse(value) as CacheStoreEntry : undefined;
    },
    async invalidateTags(tags) {
      if (tags.length === 0) return 0;
      let cursor = "0";
      let deleted = 0;
      do {
        const [nextCursor, keys] = await client.scan(
          cursor,
          "MATCH",
          `${entryPrefix}*`,
          "COUNT",
          100,
        );
        cursor = nextCursor;
        if (keys.length === 0) continue;
        const values = await client.mget(keys);
        const selected = keys.filter((_key, index) => {
          const value = values[index];
          if (!value) return false;
          // TYPE-EVIDENCE: this store reads the serialized CacheStoreEntry values that it wrote.
          const entry = JSON.parse(value) as CacheStoreEntry;
          return entry.tags.some((entryTag) => tags.includes(entryTag));
        });
        if (selected.length > 0) deleted += await client.del(...selected);
      } while (cursor !== "0");
      return deleted;
    },
    async set(key, entry) {
      await client.set(entryPrefix + key, JSON.stringify(entry));
    },
  };
}
