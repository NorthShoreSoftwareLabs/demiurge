export type SessionPrimitive = boolean | null | number | string;

export type SessionData =
  | SessionPrimitive
  | { readonly [key: string]: SessionData }
  | readonly SessionData[];

export type SessionNamespace = {
  app: string;
  environment: string;
  schemaVersion: number | string;
};

export type SessionRecord<TData extends SessionData = SessionData> = {
  createdAt: number;
  data: TData;
  expiresAt: number;
  id: string;
  idleExpiresAt?: number;
  version: number;
};

export type SessionStoreCandidate<TData extends SessionData = SessionData> =
  Omit<SessionRecord<TData>, "version">;

export type SessionStoreWriteResult<TData extends SessionData = SessionData> =
  | { record: SessionRecord<TData>; status: "stored" }
  | { status: "conflict" }
  | { status: "unavailable" };

type MaybePromise<T> = T | Promise<T>;

export type SessionStore<TData extends SessionData = SessionData> = {
  create: (
    candidate: SessionStoreCandidate<TData>,
  ) => MaybePromise<SessionStoreWriteResult<TData>>;
  destroy: (id: string) => MaybePromise<boolean>;
  read: (
    id: string,
    now: number,
  ) => MaybePromise<SessionRecord<TData> | undefined>;
  rotate: (
    currentId: string,
    candidate: SessionStoreCandidate<TData>,
    expectedVersion: number,
  ) => MaybePromise<SessionStoreWriteResult<TData>>;
  update: (
    candidate: SessionStoreCandidate<TData>,
    expectedVersion: number,
  ) => MaybePromise<SessionStoreWriteResult<TData>>;
};

export type MemorySessionStoreOptions<
  TData extends SessionData = SessionData,
> = {
  entries?: Map<string, SessionRecord<TData>>;
  namespace: SessionNamespace;
};

export function createMemorySessionStore<
  TData extends SessionData = SessionData,
>(options: MemorySessionStoreOptions<TData>): SessionStore<TData> {
  const entries = options.entries ?? new Map<string, SessionRecord<TData>>();
  const namespace = serializeSessionNamespace(options.namespace);
  const key = (id: string) => `${namespace}:${id}`;

  return {
    create(candidate) {
      const storageKey = key(candidate.id);

      if (entries.has(storageKey)) {
        return { status: "conflict" };
      }

      const record = toRecord(candidate, 0);
      entries.set(storageKey, record);
      return { record: cloneRecord(record), status: "stored" };
    },
    destroy(id) {
      return entries.delete(key(id));
    },
    read(id, now) {
      const storageKey = key(id);
      const record = entries.get(storageKey);

      if (!record) {
        return undefined;
      }

      if (isExpired(record, now)) {
        entries.delete(storageKey);
        return undefined;
      }

      return cloneRecord(record);
    },
    rotate(currentId, candidate, expectedVersion) {
      const currentKey = key(currentId);
      const nextKey = key(candidate.id);
      const current = entries.get(currentKey);

      if (
        !current ||
        current.version !== expectedVersion ||
        (nextKey !== currentKey && entries.has(nextKey))
      ) {
        return { status: "conflict" };
      }

      const record = toRecord(candidate, expectedVersion + 1);
      entries.delete(currentKey);
      entries.set(nextKey, record);
      return { record: cloneRecord(record), status: "stored" };
    },
    update(candidate, expectedVersion) {
      const storageKey = key(candidate.id);
      const current = entries.get(storageKey);

      if (!current || current.version !== expectedVersion) {
        return { status: "conflict" };
      }

      const record = toRecord(candidate, expectedVersion + 1);
      entries.set(storageKey, record);
      return { record: cloneRecord(record), status: "stored" };
    },
  };
}

export function serializeSessionNamespace(namespace: SessionNamespace) {
  const app = validateNamespacePart("app", namespace.app);
  const environment = validateNamespacePart(
    "environment",
    namespace.environment,
  );

  if (
    typeof namespace.schemaVersion === "number" &&
    (!Number.isInteger(namespace.schemaVersion) || namespace.schemaVersion < 0)
  ) {
    throw new Error(
      "Demiurge session namespace schemaVersion must be a non-negative integer or string.",
    );
  }

  const schemaVersion = validateNamespacePart(
    "schemaVersion",
    String(namespace.schemaVersion),
  );

  return [app, environment, schemaVersion].map(encodeURIComponent).join(":");
}

function validateNamespacePart(name: string, value: string) {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(
      `Demiurge session namespace ${name} must be a non-empty value without leading or trailing whitespace.`,
    );
  }

  return value;
}

function isExpired(record: SessionRecord, now: number) {
  return record.expiresAt <= now ||
    (record.idleExpiresAt !== undefined && record.idleExpiresAt <= now);
}

function toRecord<TData extends SessionData>(
  candidate: SessionStoreCandidate<TData>,
  version: number,
): SessionRecord<TData> {
  return cloneRecord({ ...candidate, version });
}

function cloneRecord<TData extends SessionData>(
  record: SessionRecord<TData>,
): SessionRecord<TData> {
  return structuredClone(record);
}
