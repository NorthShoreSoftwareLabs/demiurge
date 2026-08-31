import type { Redis } from "ioredis";
import {
  parseSessionRecord,
  serializeSessionNamespace,
  type SessionData,
  type SessionNamespace,
  type SessionRecord,
  type SessionStore,
  type SessionStoreCandidate,
} from "../security/session-store";

export type RedisSessionStoreOptions = {
  client: Redis;
  keyPrefix?: string;
  namespace: SessionNamespace;
};

const defaultKeyPrefix = "demiurge:session:";

const createScript = `
if redis.call("EXISTS", KEYS[1]) == 1 then
  return 0
end
redis.call("SET", KEYS[1], ARGV[1], "PXAT", ARGV[2])
return 1
`;

const updateScript = `
local current = redis.call("GET", KEYS[1])
if not current or cjson.decode(current).version ~= tonumber(ARGV[1]) then
  return 0
end
redis.call("SET", KEYS[1], ARGV[2], "PXAT", ARGV[3])
return 1
`;

const rotateScript = `
local current = redis.call("GET", KEYS[1])
if not current or cjson.decode(current).version ~= tonumber(ARGV[1]) then
  return 0
end
if KEYS[1] ~= KEYS[2] and redis.call("EXISTS", KEYS[2]) == 1 then
  return 0
end
redis.call("DEL", KEYS[1])
redis.call("SET", KEYS[2], ARGV[2], "PXAT", ARGV[3])
return 1
`;

type RedisSessionCommands = {
  demiurgeSessionCreate: (
    key: string,
    record: string,
    expiresAt: string,
  ) => Promise<number>;
  demiurgeSessionRotate: (
    currentKey: string,
    nextKey: string,
    expectedVersion: string,
    record: string,
    expiresAt: string,
  ) => Promise<number>;
  demiurgeSessionUpdate: (
    key: string,
    expectedVersion: string,
    record: string,
    expiresAt: string,
  ) => Promise<number>;
};

function commands(client: Redis): Redis & RedisSessionCommands {
  // TYPE-EVIDENCE: the cast adds optional custom commands before the runtime checks install them.
  const withCommands = client as Redis & Partial<RedisSessionCommands>;

  if (!withCommands.demiurgeSessionCreate) {
    client.defineCommand("demiurgeSessionCreate", {
      lua: createScript,
      numberOfKeys: 1,
    });
  }

  if (!withCommands.demiurgeSessionUpdate) {
    client.defineCommand("demiurgeSessionUpdate", {
      lua: updateScript,
      numberOfKeys: 1,
    });
  }

  if (!withCommands.demiurgeSessionRotate) {
    client.defineCommand("demiurgeSessionRotate", {
      lua: rotateScript,
      numberOfKeys: 2,
    });
  }

  // TYPE-EVIDENCE: the defineCommand calls install each command. The cast reflects the resulting client shape.
  return withCommands as Redis & RedisSessionCommands;
}

export function createRedisSessionStore<
  TData extends SessionData = SessionData,
>(options: RedisSessionStoreOptions): SessionStore<TData> {
  if (!options.client || typeof options.client.defineCommand !== "function") {
    throw new Error(
      "Demiurge Redis session store requires an ioredis client. Pass a connected ioredis Redis instance as `client`.",
    );
  }

  const client = commands(options.client);
  const namespace = serializeSessionNamespace(options.namespace);
  const prefix = `${options.keyPrefix ?? defaultKeyPrefix}${namespace}:`;
  const key = (id: string) => prefix + id;

  return {
    async create(candidate) {
      const record = toRecord(candidate, 0);

      try {
        const stored = await client.demiurgeSessionCreate(
          key(record.id),
          JSON.stringify(record),
          String(storeExpiration(record)),
        );
        return stored === 1
          ? { record, status: "stored" }
          : { status: "conflict" };
      } catch {
        return { status: "unavailable" };
      }
    },
    async destroy(id) {
      return await client.del(key(id)) === 1;
    },
    async read(id, now) {
      const raw = await client.get(key(id));

      if (!raw) {
        return undefined;
      }

      const record = parseRecord<TData>(raw);

      if (!record) {
        return undefined;
      }

      if (storeExpiration(record) <= now) {
        await client.del(key(id));
        return undefined;
      }

      return record;
    },
    async rotate(currentId, candidate, expectedVersion) {
      const record = toRecord(candidate, expectedVersion + 1);

      try {
        const stored = await client.demiurgeSessionRotate(
          key(currentId),
          key(record.id),
          String(expectedVersion),
          JSON.stringify(record),
          String(storeExpiration(record)),
        );
        return stored === 1
          ? { record, status: "stored" }
          : { status: "conflict" };
      } catch {
        return { status: "unavailable" };
      }
    },
    async update(candidate, expectedVersion) {
      const record = toRecord(candidate, expectedVersion + 1);

      try {
        const stored = await client.demiurgeSessionUpdate(
          key(record.id),
          String(expectedVersion),
          JSON.stringify(record),
          String(storeExpiration(record)),
        );
        return stored === 1
          ? { record, status: "stored" }
          : { status: "conflict" };
      } catch {
        return { status: "unavailable" };
      }
    },
  };
}

function parseRecord<TData extends SessionData>(
  raw: string,
): SessionRecord<TData> | undefined {
  try {
    return parseSessionRecord<TData>(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function toRecord<TData extends SessionData>(
  candidate: SessionStoreCandidate<TData>,
  version: number,
): SessionRecord<TData> {
  return structuredClone({ ...candidate, version });
}

function storeExpiration(record: SessionRecord) {
  return Math.min(record.expiresAt, record.idleExpiresAt ?? record.expiresAt);
}
