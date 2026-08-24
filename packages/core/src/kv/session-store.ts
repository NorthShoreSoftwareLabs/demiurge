import {
  serializeSessionNamespace,
  type SessionData,
  type SessionNamespace,
  type SessionRecord,
  type SessionStore,
  type SessionStoreCandidate,
} from "../security/session-store";
import type { EdgeKvNamespace, EdgeKvPutOptions } from "./store";

export type EdgeKvAtomicOperation = {
  expected: string | null;
  key: string;
  write?: {
    options?: EdgeKvPutOptions;
    value: string;
  };
};

export type EdgeKvSessionNamespace = EdgeKvNamespace & {
  atomic: (operations: readonly EdgeKvAtomicOperation[]) => Promise<boolean>;
};

export type KvSessionStoreOptions = {
  keyPrefix?: string;
  namespace: SessionNamespace;
  store: EdgeKvSessionNamespace;
};

const defaultKeyPrefix = "demiurge:session:";

export function createKvSessionStore<
  TData extends SessionData = SessionData,
>(options: KvSessionStoreOptions): SessionStore<TData> {
  if (!options.store || typeof options.store.get !== "function") {
    throw new Error(
      "Demiurge KV session store requires an EdgeKvSessionNamespace. Pass an application-owned KV client as `store`.",
    );
  }

  if (typeof options.store.atomic !== "function") {
    throw new Error(
      "Demiurge KV session store requires atomic compare-and-swap operations. Adapt the provider transaction API to EdgeKvSessionNamespace.atomic.",
    );
  }

  const store = options.store;
  const namespace = serializeSessionNamespace(options.namespace);
  const prefix = `${options.keyPrefix ?? defaultKeyPrefix}${namespace}:`;
  const key = (id: string) => prefix + id;

  return {
    async create(candidate) {
      const record = toRecord(candidate, 0);

      try {
        const stored = await store.atomic([putOperation(key(record.id), null, record)]);
        return stored
          ? { record, status: "stored" }
          : { status: "conflict" };
      } catch {
        return { status: "unavailable" };
      }
    },
    async destroy(id) {
      const storageKey = key(id);
      const current = await store.get(storageKey);

      if (current === null) {
        return false;
      }

      return await store.atomic([{ expected: current, key: storageKey }]);
    },
    async read(id, now) {
      const storageKey = key(id);
      const raw = await store.get(storageKey);

      if (raw === null) {
        return undefined;
      }

      // TYPE-EVIDENCE: this store reads JSON that a conforming atomic write serialized from a session record.
      const record = JSON.parse(raw) as SessionRecord<TData>;

      if (storeExpiration(record) <= now) {
        await store.atomic([{ expected: raw, key: storageKey }]);
        return undefined;
      }

      return record;
    },
    async rotate(currentId, candidate, expectedVersion) {
      const currentKey = key(currentId);
      const nextKey = key(candidate.id);
      const [current, next] = await Promise.all([
        store.get(currentKey),
        currentKey === nextKey ? Promise.resolve(null) : store.get(nextKey),
      ]);

      if (!current || (nextKey !== currentKey && next !== null)) {
        return { status: "conflict" };
      }

      const currentRecord = parseRecord<TData>(current);

      if (currentRecord.version !== expectedVersion) {
        return { status: "conflict" };
      }

      const record = toRecord(candidate, expectedVersion + 1);
      const operations = currentKey === nextKey
        ? [putOperation(currentKey, current, record)]
        : [
          { expected: current, key: currentKey },
          putOperation(nextKey, null, record),
        ];

      try {
        const stored = await store.atomic(operations);
        return stored
          ? { record, status: "stored" }
          : { status: "conflict" };
      } catch {
        return { status: "unavailable" };
      }
    },
    async update(candidate, expectedVersion) {
      const storageKey = key(candidate.id);
      const current = await store.get(storageKey);

      if (!current || parseRecord<TData>(current).version !== expectedVersion) {
        return { status: "conflict" };
      }

      const record = toRecord(candidate, expectedVersion + 1);

      try {
        const stored = await store.atomic([
          putOperation(storageKey, current, record),
        ]);
        return stored
          ? { record, status: "stored" }
          : { status: "conflict" };
      } catch {
        return { status: "unavailable" };
      }
    },
  };
}

function putOperation(
  key: string,
  expected: string | null,
  record: SessionRecord,
): EdgeKvAtomicOperation {
  return {
    expected,
    key,
    write: {
      options: { expiration: Math.ceil(storeExpiration(record) / 1000) },
      value: JSON.stringify(record),
    },
  };
}

function parseRecord<TData extends SessionData>(raw: string) {
  // TYPE-EVIDENCE: session stores serialize this internal value before each atomic write.
  return JSON.parse(raw) as SessionRecord<TData>;
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
