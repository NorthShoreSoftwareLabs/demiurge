import type { Redis } from "ioredis";
import type { RateLimitResult, RateLimitStore } from "../security/types";

export type RedisRateLimitStoreOptions = {
  // Every consumer of one Redis database shares one keyspace. This prefix
  // scopes the store's counter keys away from an application's other Redis
  // use, the same way RedisCacheStoreOptions.keyPrefix does for the cache
  // store. Two Demiurge deployments that share a database still need
  // distinct prefixes.
  keyPrefix?: string;
  // The store issues commands on a client the application already
  // constructed and connected. Connection options, TLS, Sentinel, and retry
  // policy are the application's decision, not this store's.
  client: Redis;
};

const defaultKeyPrefix = "demiurge:ratelimit:";

// KEYS[1] counter key. ARGV[1] window in ms.
//
// INCR and PEXPIRE run inside one script. Redis executes the whole script
// as a single atomic step, so two instances racing to increment the same
// key never both observe count 1. The window's reset time comes from
// Redis's own clock (TIME), not the caller-supplied `now`. The counter's
// TTL is authoritative once several processes share it, and a
// client-supplied timestamp could disagree with the server that expires the
// key. TIME is deterministic across replication because Redis rewrites the
// script's effects rather than replaying non-deterministic commands.
const incrementScript = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
if ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
local time = redis.call("TIME")
local nowMs = math.floor(tonumber(time[1]) * 1000 + tonumber(time[2]) / 1000)
return { count, nowMs + ttl }
`;

type RedisRateLimitCommands = {
  demiurgeRateLimitIncrement: (
    counterKey: string,
    windowMs: string,
  ) => Promise<[number, number]>;
};

// The application already owns one ioredis client. Attaching the store's
// command is idempotent, so building several stores on the same client, or
// rebuilding one after a reconnect, never redefines the command twice.
function commands(client: Redis): Redis & RedisRateLimitCommands {
  // TYPE-EVIDENCE: the cast adds the optional custom command methods before the runtime check installs them.
  const withCommands = client as Redis & Partial<RedisRateLimitCommands>;

  if (!withCommands.demiurgeRateLimitIncrement) {
    client.defineCommand("demiurgeRateLimitIncrement", {
      lua: incrementScript,
      numberOfKeys: 1,
    });
  }

  // TYPE-EVIDENCE: the defineCommand call above installs the custom command. The cast reflects that the method now exists.
  return withCommands as Redis & RedisRateLimitCommands;
}

export function createRedisRateLimitStore(
  options: RedisRateLimitStoreOptions,
): RateLimitStore {
  if (!options.client || typeof options.client.defineCommand !== "function") {
    throw new Error(
      "Demiurge Redis rate limit store requires an ioredis client. Pass a connected ioredis Redis instance as `client`.",
    );
  }

  const client = commands(options.client);
  const prefix = options.keyPrefix ?? defaultKeyPrefix;

  return {
    async increment(key, windowMs): Promise<RateLimitResult> {
      const [count, resetAt] = await client.demiurgeRateLimitIncrement(
        prefix + key,
        String(windowMs),
      );

      return { count, resetAt };
    },
  };
}
