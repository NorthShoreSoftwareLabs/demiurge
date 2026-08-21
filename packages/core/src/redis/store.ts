import type { Redis } from "ioredis";
import type { CacheStore, CacheStoreEntry } from "../data/cache";

export type RedisCacheStoreOptions = {
  // Every consumer of one Redis database shares one keyspace. This prefix
  // scopes the store's entry, tag, and lease keys away from an application's
  // other Redis use. Two Demiurge deployments that share a database still
  // need distinct prefixes, the same way they need distinct cache namespaces.
  keyPrefix?: string;
  // The store issues commands on a client the application already
  // constructed and connected. Connection options, TLS, Sentinel, and retry
  // policy are the application's decision, not this store's.
  client: Redis;
};

const defaultKeyPrefix = "demiurge:cache:";

// Tag sets hold the raw, unprefixed cache key as each member, never the
// prefixed entry key. invalidateTags() only knows a tag's members. It
// rebuilds both the entry key and the lease key by applying their prefixes.
// Every script below adds and removes the same raw-key member, so the two
// stay in agreement.

// KEYS[1] entry key, KEYS[2] lease key.
// ARGV[1] entry JSON, ARGV[2] staleUntil epoch ms or "".
// ARGV[3] tag key prefix, ARGV[4] raw key.
const setScript = `
local old = redis.call("GET", KEYS[1])
if old then
  local oldTags = cjson.decode(old).tags
  for i = 1, #oldTags do
    redis.call("SREM", ARGV[3] .. oldTags[i], ARGV[4])
  end
end
redis.call("SET", KEYS[1], ARGV[1])
if ARGV[2] ~= "" then
  redis.call("PEXPIREAT", KEYS[1], ARGV[2])
end
local newTags = cjson.decode(ARGV[1]).tags
for i = 1, #newTags do
  redis.call("SADD", ARGV[3] .. newTags[i], ARGV[4])
end
redis.call("DEL", KEYS[2])
return 1
`;

// KEYS[1] entry key, KEYS[2] lease key.
// ARGV[1] tag key prefix, ARGV[2] raw key.
const deleteScript = `
local old = redis.call("GET", KEYS[1])
redis.call("DEL", KEYS[2])
if not old then
  return 0
end
local oldTags = cjson.decode(old).tags
for i = 1, #oldTags do
  redis.call("SREM", ARGV[1] .. oldTags[i], ARGV[2])
end
redis.call("DEL", KEYS[1])
return 1
`;

// No declared KEYS. Tags name a variable number of sets, so the script reads
// their redis keys from ARGV instead.
// ARGV[1] tags JSON array, ARGV[2] tag key prefix, ARGV[3] entry key prefix,
// ARGV[4] lease key prefix
const invalidateTagsScript = `
local tags = cjson.decode(ARGV[1])
local seen = {}
local deleted = 0
for i = 1, #tags do
  local tagSetKey = ARGV[2] .. tags[i]
  local members = redis.call("SMEMBERS", tagSetKey)
  for j = 1, #members do
    local rawKey = members[j]
    if not seen[rawKey] then
      seen[rawKey] = true
      local entryKey = ARGV[3] .. rawKey
      local old = redis.call("GET", entryKey)
      if old then
        local oldTags = cjson.decode(old).tags
        for t = 1, #oldTags do
          redis.call("SREM", ARGV[2] .. oldTags[t], rawKey)
        end
        redis.call("DEL", entryKey)
        redis.call("DEL", ARGV[4] .. rawKey)
        deleted = deleted + 1
      else
        redis.call("SREM", tagSetKey, rawKey)
      end
    end
  end
  redis.call("DEL", tagSetKey)
end
return deleted
`;

// KEYS[1] entry key, KEYS[2] lease key.
// ARGV[1] token, ARGV[2] entry JSON, ARGV[3] staleUntil epoch ms or "".
// ARGV[4] tag key prefix, ARGV[5] raw key.
const publishRefreshScript = `
local owner = redis.call("GET", KEYS[2])
if not owner or owner ~= ARGV[1] then
  return 0
end
local old = redis.call("GET", KEYS[1])
if old then
  local oldTags = cjson.decode(old).tags
  for i = 1, #oldTags do
    redis.call("SREM", ARGV[4] .. oldTags[i], ARGV[5])
  end
end
redis.call("SET", KEYS[1], ARGV[2])
if ARGV[3] ~= "" then
  redis.call("PEXPIREAT", KEYS[1], ARGV[3])
end
local newTags = cjson.decode(ARGV[2]).tags
for i = 1, #newTags do
  redis.call("SADD", ARGV[4] .. newTags[i], ARGV[5])
end
redis.call("DEL", KEYS[2])
return 1
`;

// KEYS[1] lease key, ARGV[1] token
const releaseRefreshLeaseScript = `
local owner = redis.call("GET", KEYS[1])
if owner == ARGV[1] then
  redis.call("DEL", KEYS[1])
end
return 0
`;

type RedisCacheCommands = {
  demiurgeCacheSet: (
    entryKey: string,
    leaseKey: string,
    entryJson: string,
    staleUntil: string,
    tagPrefix: string,
    rawKey: string,
  ) => Promise<number>;
  demiurgeCacheDelete: (
    entryKey: string,
    leaseKey: string,
    tagPrefix: string,
    rawKey: string,
  ) => Promise<number>;
  demiurgeCacheInvalidateTags: (
    tagsJson: string,
    tagPrefix: string,
    entryPrefix: string,
    leasePrefix: string,
  ) => Promise<number>;
  demiurgeCachePublishRefresh: (
    entryKey: string,
    leaseKey: string,
    token: string,
    entryJson: string,
    staleUntil: string,
    tagPrefix: string,
    rawKey: string,
  ) => Promise<number>;
  demiurgeCacheReleaseRefreshLease: (
    leaseKey: string,
    token: string,
  ) => Promise<number>;
};

// The application already owns one ioredis client. Attaching the store's
// commands is idempotent, so building several stores on the same client, or
// rebuilding one after a reconnect, never redefines a command twice.
function commands(client: Redis): Redis & RedisCacheCommands {
  // TYPE-EVIDENCE: the cast adds the optional custom command methods before the runtime checks install them.
  const withCommands = client as Redis & Partial<RedisCacheCommands>;

  if (!withCommands.demiurgeCacheSet) {
    client.defineCommand("demiurgeCacheSet", { lua: setScript, numberOfKeys: 2 });
  }

  if (!withCommands.demiurgeCacheDelete) {
    client.defineCommand("demiurgeCacheDelete", {
      lua: deleteScript,
      numberOfKeys: 2,
    });
  }

  if (!withCommands.demiurgeCacheInvalidateTags) {
    client.defineCommand("demiurgeCacheInvalidateTags", {
      lua: invalidateTagsScript,
      numberOfKeys: 0,
    });
  }

  if (!withCommands.demiurgeCachePublishRefresh) {
    client.defineCommand("demiurgeCachePublishRefresh", {
      lua: publishRefreshScript,
      numberOfKeys: 2,
    });
  }

  if (!withCommands.demiurgeCacheReleaseRefreshLease) {
    client.defineCommand("demiurgeCacheReleaseRefreshLease", {
      lua: releaseRefreshLeaseScript,
      numberOfKeys: 1,
    });
  }

  // TYPE-EVIDENCE: the defineCommand calls above install each custom command. The cast reflects that the methods now exist.
  return withCommands as Redis & RedisCacheCommands;
}

// Redis holds the entry, its tag memberships, and its refresh lease as
// independent keys. Every process talking to the same database must see
// these three stay coordinated. Each write path therefore runs as one Lua
// script rather than several round trips a concurrent writer could
// interleave with.
export function createRedisCacheStore(
  options: RedisCacheStoreOptions,
): CacheStore {
  if (!options.client || typeof options.client.defineCommand !== "function") {
    throw new Error(
      "Demiurge Redis cache store requires an ioredis client. Pass a connected ioredis Redis instance as `client`.",
    );
  }

  const client = commands(options.client);
  const prefix = options.keyPrefix ?? defaultKeyPrefix;
  const entryPrefix = `${prefix}entry:`;
  const tagPrefix = `${prefix}tag:`;
  const leasePrefix = `${prefix}lease:`;

  return {
    async acquireRefreshLease(key, token, expiresAt) {
      // ioredis's typed SET overloads do not cover every flag order the
      // Redis SET command accepts, so this issues the raw command instead.
      const result = await client.call(
        "SET",
        leasePrefix + key,
        token,
        "NX",
        "PXAT",
        String(expiresAt),
      );

      return result === "OK";
    },
    async delete(key) {
      const deleted = await client.demiurgeCacheDelete(
        entryPrefix + key,
        leasePrefix + key,
        tagPrefix,
        key,
      );

      return deleted === 1;
    },
    async get(key) {
      const raw = await client.get(entryPrefix + key);
      // TYPE-EVIDENCE: the stored raw value is JSON that the store serialized from a cache entry. The cast restores that shape.
      return raw ? (JSON.parse(raw) as CacheStoreEntry) : undefined;
    },
    async invalidateTags(tags) {
      if (tags.length === 0) {
        return 0;
      }

      return await client.demiurgeCacheInvalidateTags(
        JSON.stringify(tags),
        tagPrefix,
        entryPrefix,
        leasePrefix,
      );
    },
    async publishRefresh(key, token, entry) {
      const result = await client.demiurgeCachePublishRefresh(
        entryPrefix + key,
        leasePrefix + key,
        token,
        JSON.stringify(entry),
        entry.staleUntil === null ? "" : String(entry.staleUntil),
        tagPrefix,
        key,
      );

      return result === 1;
    },
    async releaseRefreshLease(key, token) {
      await client.demiurgeCacheReleaseRefreshLease(leasePrefix + key, token);
    },
    async set(key, entry) {
      await client.demiurgeCacheSet(
        entryPrefix + key,
        leasePrefix + key,
        JSON.stringify(entry),
        entry.staleUntil === null ? "" : String(entry.staleUntil),
        tagPrefix,
        key,
      );
    },
  };
}
