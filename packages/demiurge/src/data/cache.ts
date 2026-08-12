export type CacheScope =
  | "build"
  | "none"
  | "private"
  | "public"
  | "request";

export type CacheKeyPart =
  | boolean
  | null
  | number
  | string
  | { readonly [key: string]: CacheKeyPart }
  | readonly CacheKeyPart[];

export type CacheKey = readonly CacheKeyPart[];

export type CacheTag = {
  id: string;
};

export type CacheDuration = number | `${number}${"h" | "m" | "ms" | "s"}`;

type MaybePromise<T> = T | Promise<T>;

export type CacheRequest<TResult> = {
  fn: () => MaybePromise<TResult>;
  key: CacheKey;
  scope?: CacheScope;
  staleWhileRevalidate?: CacheDuration;
  tags?: readonly CacheTag[];
  ttl?: CacheDuration;
};

export type QueryDefinition<TArgs extends readonly unknown[], TResult> = {
  fn: (...args: TArgs) => MaybePromise<TResult>;
  key: (...args: TArgs) => CacheKey;
  scope?: CacheScope;
  staleWhileRevalidate?: CacheDuration;
  tags?: (...args: TArgs) => readonly CacheTag[];
  ttl?: CacheDuration;
};

export type Query<TArgs extends readonly unknown[], TResult> = (
  ...args: TArgs
) => CacheRequest<TResult>;

export type Cache = {
  get: <TResult>(request: CacheRequest<TResult>) => Promise<TResult>;
  invalidateKey: (key: CacheKey) => Promise<boolean>;
  invalidateTags: (tags: readonly CacheTag[]) => Promise<number>;
};

export type CacheNamespace = {
  app: string;
  environment: string;
  schemaVersion: number | string;
};

export type CacheStoreEntry = {
  expiresAt: number | null;
  staleUntil: number | null;
  tags: readonly string[];
  value: unknown;
};

export type CacheStore = {
  acquireRefreshLease?: (
    key: string,
    token: string,
    expiresAt: number,
  ) => MaybePromise<boolean>;
  delete: (key: string) => MaybePromise<boolean>;
  get: (key: string) => MaybePromise<CacheStoreEntry | undefined>;
  invalidateTags: (tags: readonly string[]) => MaybePromise<number>;
  publishRefresh?: (
    key: string,
    token: string,
    entry: CacheStoreEntry,
  ) => MaybePromise<boolean>;
  releaseRefreshLease?: (key: string, token: string) => MaybePromise<void>;
  set: (key: string, entry: CacheStoreEntry) => MaybePromise<void>;
};

export type CreateCacheOptions = {
  namespace: CacheNamespace;
  now?: () => number;
  onBackgroundError?: (error: unknown) => void;
  refreshLeaseTtl?: CacheDuration;
  store: CacheStore;
  waitUntil?: (promise: Promise<void>) => void;
};

export type Invalidation = {
  key: (key: CacheKey) => Promise<InvalidationResult>;
  keys: (keys: readonly CacheKey[]) => Promise<InvalidationResult>;
  tag: (tag: CacheTag) => Promise<InvalidationResult>;
  tags: (tags: readonly CacheTag[]) => Promise<InvalidationResult>;
};

export type InvalidationResult = {
  deleted: number;
  kind: "key" | "tag";
};

type RequestCacheEntry<TResult> = {
  expiresAt: number;
  tags: readonly string[];
  value: Promise<TResult>;
};

type PendingStoreEntry = {
  promise: Promise<unknown>;
  state: { invalidated: boolean };
  tags: readonly string[];
};

type CoordinatedCacheStore = CacheStore &
  Required<
    Pick<
      CacheStore,
      | "acquireRefreshLease"
      | "publishRefresh"
      | "releaseRefreshLease"
    >
  >;

export type MemoryCacheOptions = {
  maximumEntries?: number;
  now?: () => number;
  onBackgroundError?: (error: unknown) => void;
  refreshLeaseTtl?: CacheDuration;
  waitUntil?: (promise: Promise<void>) => void;
};

export type MemoryCacheStoreOptions = {
  entries?: Map<string, CacheStoreEntry>;
  maximumEntries?: number;
  now?: () => number;
};

const sharedScopes = ["build", "private", "public"] as const;
const memoryNamespace = {
  app: "demiurge-memory",
  environment: "local",
  schemaVersion: 1,
} satisfies CacheNamespace;
const defaultMemoryCacheMaximumEntries = 10_000;
const defaultRefreshLeaseTtl = 30_000;

export function query<TArgs extends readonly unknown[], TResult>(
  definition: QueryDefinition<TArgs, TResult>,
): Query<TArgs, TResult> {
  return (...args) => ({
    fn: () => definition.fn(...args),
    key: definition.key(...args),
    scope: definition.scope,
    staleWhileRevalidate: definition.staleWhileRevalidate,
    tags: definition.tags?.(...args),
    ttl: definition.ttl,
  });
}

export function tag(id: string): CacheTag {
  return { id };
}

export function defineTags<
  TTags extends Record<string, (...args: never[]) => CacheTag>,
>(tags: TTags) {
  return tags;
}

export function createCache(options: CreateCacheOptions): Cache {
  const now = options.now ?? Date.now;
  const refreshLeaseTtl = parseRefreshLeaseTtl(options.refreshLeaseTtl);
  const namespace = serializeCacheNamespace(options.namespace);
  const requestEntries = new Map<string, RequestCacheEntry<unknown>>();
  const sharedPending = new Map<string, PendingStoreEntry>();

  return {
    async get<TResult>(request: CacheRequest<TResult>) {
      const scope = request.scope ?? "request";

      if (scope === "none") {
        return await request.fn();
      }

      const rawKey = serializeCacheKey(request.key);

      if (scope === "request") {
        return await getRequestValue(requestEntries, rawKey, request, now);
      }

      const key = serializeStoreKey(namespace, scope, rawKey);
      const tags = (request.tags ?? []).map((value) =>
        serializeStoreTag(namespace, scope, serializeCacheTag(value))
      );
      const existing = await options.store.get(key);

      if (
        existing &&
        (existing.expiresAt === null || existing.expiresAt > now())
      ) {
        return existing.value as TResult;
      }

      if (existing && isStaleEntryUsable(existing, now())) {
        const refreshStore = requireRefreshStore(options.store);
        const token = globalThis.crypto.randomUUID();
        const acquired = await refreshStore.acquireRefreshLease(
          key,
          token,
          now() + refreshLeaseTtl,
        );

        if (acquired) {
          const refresh = refreshStaleEntry({
            key,
            now,
            onBackgroundError: options.onBackgroundError,
            refreshStore,
            request,
            tags,
            token,
          });

          options.waitUntil?.(refresh);
        }

        return existing.value as TResult;
      }

      if (existing) {
        await options.store.delete(key);
      }

      const currentPending = sharedPending.get(key);

      if (currentPending) {
        return await currentPending.promise as TResult;
      }

      const state = { invalidated: false };
      const value = Promise.resolve().then(request.fn).then(async (result) => {
        if (!state.invalidated) {
          await options.store.set(key, {
            expiresAt: storeExpirationTime(now(), request.ttl),
            staleUntil: storeStaleTime(
              now(),
              request.ttl,
              request.staleWhileRevalidate,
            ),
            tags,
            value: result,
          });
        }

        return result;
      });
      const pending: PendingStoreEntry = {
        promise: value,
        state,
        tags,
      };
      sharedPending.set(key, pending);

      try {
        return await value;
      } finally {
        if (sharedPending.get(key) === pending) {
          sharedPending.delete(key);
        }
      }
    },
    async invalidateKey(key: CacheKey) {
      const rawKey = serializeCacheKey(key);
      const deletedRequest = requestEntries.delete(rawKey);
      let deletedPending = false;

      const deletedShared = await Promise.all(
        sharedScopes.map((scope) => {
          const storeKey = serializeStoreKey(namespace, scope, rawKey);
          const pending = sharedPending.get(storeKey);

          if (pending) {
            pending.state.invalidated = true;
            deletedPending = true;
          }

          return options.store.delete(storeKey);
        }),
      );

      return deletedRequest || deletedPending || deletedShared.some(Boolean);
    },
    async invalidateTags(tags: readonly CacheTag[]) {
      const rawTags = tags.map(serializeCacheTag);
      const deletedRequest = deleteMatchingRequestTags(
        requestEntries,
        new Set(rawTags),
      );
      const storeTags = new Set(
        sharedScopes.flatMap((scope) =>
          rawTags.map((value) => serializeStoreTag(namespace, scope, value))
        ),
      );
      let deletedPending = 0;

      for (const pending of sharedPending.values()) {
        if (
          !pending.state.invalidated &&
          pending.tags.some((value) => storeTags.has(value))
        ) {
          pending.state.invalidated = true;
          deletedPending += 1;
        }
      }

      const deletedShared = await options.store.invalidateTags([...storeTags]);

      return deletedRequest + deletedPending + deletedShared;
    },
  };
}

export function createMemoryCache(options: MemoryCacheOptions = {}): Cache {
  const now = options.now ?? Date.now;

  return createCache({
    namespace: memoryNamespace,
    now,
    onBackgroundError: options.onBackgroundError,
    refreshLeaseTtl: options.refreshLeaseTtl,
    store: createMemoryCacheStore({
      maximumEntries: options.maximumEntries,
      now,
    }),
    waitUntil: options.waitUntil,
  });
}

export function createMemoryCacheStore(
  options: MemoryCacheStoreOptions = {},
): CacheStore {
  const entries = options.entries ?? new Map<string, CacheStoreEntry>();
  const refreshLeases = new Map<string, { expiresAt: number; token: string }>();
  const maximumEntries =
    options.maximumEntries ?? defaultMemoryCacheMaximumEntries;
  const now = options.now ?? Date.now;

  if (!Number.isSafeInteger(maximumEntries) || maximumEntries <= 0) {
    throw new Error(
      "Demiurge memory cache maximumEntries must be a positive integer.",
    );
  }

  sweepExpiredCacheEntries(entries, refreshLeases, now());
  evictOldestCacheEntries(entries, maximumEntries);
  let nextExpiration = findNextCacheExpiration(entries);

  return {
    acquireRefreshLease(key, token, expiresAt) {
      const currentTime = now();
      const existing = refreshLeases.get(key);

      if (existing && existing.expiresAt > currentTime) {
        return false;
      }

      refreshLeases.set(key, { expiresAt, token });
      return true;
    },
    delete(key) {
      refreshLeases.delete(key);
      return entries.delete(key);
    },
    get(key) {
      if (now() >= nextExpiration) {
        sweepExpiredCacheEntries(entries, refreshLeases, now());
        nextExpiration = findNextCacheExpiration(entries);
      }

      return entries.get(key);
    },
    invalidateTags(tags) {
      const serializedTags = new Set(tags);
      let deleted = 0;

      for (const [key, entry] of entries) {
        if (entry.tags.some((value) => serializedTags.has(value))) {
          entries.delete(key);
          refreshLeases.delete(key);
          deleted += 1;
        }
      }

      return deleted;
    },
    publishRefresh(key, token, entry) {
      const lease = refreshLeases.get(key);

      if (!lease || lease.token !== token || lease.expiresAt <= now()) {
        return false;
      }

      setMemoryCacheEntry(
        entries,
        refreshLeases,
        maximumEntries,
        key,
        entry,
      );
      refreshLeases.delete(key);

      if (entry.staleUntil !== null) {
        nextExpiration = Math.min(nextExpiration, entry.staleUntil);
      }

      return true;
    },
    releaseRefreshLease(key, token) {
      if (refreshLeases.get(key)?.token === token) {
        refreshLeases.delete(key);
      }
    },
    set(key, entry) {
      const currentTime = now();

      if (currentTime >= nextExpiration) {
        sweepExpiredCacheEntries(entries, refreshLeases, currentTime);
        nextExpiration = findNextCacheExpiration(entries);
      }

      refreshLeases.delete(key);
      setMemoryCacheEntry(
        entries,
        refreshLeases,
        maximumEntries,
        key,
        entry,
      );

      if (entry.staleUntil !== null) {
        nextExpiration = Math.min(nextExpiration, entry.staleUntil);
      }
    },
  };
}

function sweepExpiredCacheEntries(
  entries: Map<string, CacheStoreEntry>,
  refreshLeases: Map<string, { expiresAt: number; token: string }>,
  now: number,
) {
  for (const [key, entry] of entries) {
    if (entry.staleUntil !== null && entry.staleUntil <= now) {
      entries.delete(key);
      refreshLeases.delete(key);
    }
  }
}

function setMemoryCacheEntry(
  entries: Map<string, CacheStoreEntry>,
  refreshLeases: Map<string, { expiresAt: number; token: string }>,
  maximumEntries: number,
  key: string,
  entry: CacheStoreEntry,
) {
  if (!entries.has(key) && entries.size >= maximumEntries) {
    while (entries.size >= maximumEntries) {
      const oldestKey = entries.keys().next().value;

      if (oldestKey === undefined) {
        break;
      }

      entries.delete(oldestKey);
      refreshLeases.delete(oldestKey);
    }
  }

  entries.set(key, entry);
}

function evictOldestCacheEntries(
  entries: Map<string, CacheStoreEntry>,
  targetSize: number,
) {
  while (entries.size > targetSize) {
    const oldestKey = entries.keys().next().value;

    if (oldestKey === undefined) {
      return;
    }

    entries.delete(oldestKey);
  }
}

function findNextCacheExpiration(entries: Map<string, CacheStoreEntry>) {
  let nextExpiration = Number.POSITIVE_INFINITY;

  for (const entry of entries.values()) {
    if (entry.staleUntil !== null) {
      nextExpiration = Math.min(nextExpiration, entry.staleUntil);
    }
  }

  return nextExpiration;
}

export function serializeCacheNamespace(namespace: CacheNamespace) {
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
      "Demiurge cache namespace schemaVersion must be a non-negative integer or string.",
    );
  }

  const schemaVersion = validateNamespacePart(
    "schemaVersion",
    String(namespace.schemaVersion),
  );

  return `${app}:${environment}:${schemaVersion}`;
}

export function createInvalidation(
  cache: Pick<Cache, "invalidateKey" | "invalidateTags">,
): Invalidation {
  return {
    async key(key) {
      return {
        deleted: await cache.invalidateKey(key) ? 1 : 0,
        kind: "key",
      };
    },
    async keys(keys) {
      let deleted = 0;

      for (const key of keys) {
        if (await cache.invalidateKey(key)) {
          deleted += 1;
        }
      }

      return {
        deleted,
        kind: "key",
      };
    },
    async tag(tag) {
      return {
        deleted: await cache.invalidateTags([tag]),
        kind: "tag",
      };
    },
    async tags(tags) {
      return {
        deleted: await cache.invalidateTags(tags),
        kind: "tag",
      };
    },
  };
}

export function parseCacheDuration(duration: CacheDuration | undefined) {
  if (duration === undefined) {
    return Number.POSITIVE_INFINITY;
  }

  if (typeof duration === "number") {
    if (!Number.isInteger(duration) || duration < 0) {
      throw new Error("Demiurge cache duration must be a non-negative integer.");
    }

    return duration;
  }

  const match = /^(\d+)(ms|s|m|h)$/.exec(duration);

  if (!match) {
    throw new Error("Demiurge cache duration must use an ms/s/m/h suffix.");
  }

  const value = Number(match[1]);
  const unit = match[2];

  if (unit === "h") {
    return value * 3_600_000;
  }

  if (unit === "m") {
    return value * 60_000;
  }

  if (unit === "s") {
    return value * 1_000;
  }

  return value;
}

export function serializeCacheKey(key: CacheKey) {
  return stableSerialize(key, new Set<object>());
}

export function serializeCacheTag(tag: CacheTag) {
  return tag.id;
}

async function getRequestValue<TResult>(
  entries: Map<string, RequestCacheEntry<unknown>>,
  key: string,
  request: CacheRequest<TResult>,
  now: () => number,
) {
  const existing = entries.get(key);

  if (existing && existing.expiresAt > now()) {
    return await existing.value as TResult;
  }

  const value = Promise.resolve().then(request.fn);
  const entry = {
    expiresAt: now() + parseCacheDuration(request.ttl),
    tags: (request.tags ?? []).map(serializeCacheTag),
    value,
  } satisfies RequestCacheEntry<TResult>;

  entries.set(key, entry);

  try {
    return await value;
  } catch (error) {
    if (entries.get(key) === entry) {
      entries.delete(key);
    }

    throw error;
  }
}

function serializeStoreKey(
  namespace: string,
  scope: (typeof sharedScopes)[number],
  key: string,
) {
  return `${namespace}:${scope}:key:${key}`;
}

function serializeStoreTag(
  namespace: string,
  scope: (typeof sharedScopes)[number],
  tag: string,
) {
  return `${namespace}:${scope}:tag:${tag}`;
}

function storeExpirationTime(now: number, ttl: CacheDuration | undefined) {
  const duration = parseCacheDuration(ttl);
  return Number.isFinite(duration) ? now + duration : null;
}

function storeStaleTime(
  now: number,
  ttl: CacheDuration | undefined,
  staleWhileRevalidate: CacheDuration | undefined,
) {
  const duration = parseCacheDuration(ttl);

  if (!Number.isFinite(duration)) {
    if (staleWhileRevalidate !== undefined) {
      throw new Error(
        "Demiurge staleWhileRevalidate requires a finite cache ttl.",
      );
    }

    return null;
  }

  return now + duration + parseCacheDuration(staleWhileRevalidate ?? 0);
}

function parseRefreshLeaseTtl(duration: CacheDuration | undefined) {
  const milliseconds = parseCacheDuration(duration ?? defaultRefreshLeaseTtl);

  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    throw new Error(
      "Demiurge cache refreshLeaseTtl must be a positive finite duration.",
    );
  }

  return milliseconds;
}

function isStaleEntryUsable(entry: CacheStoreEntry, now: number) {
  return (
    entry.expiresAt !== null &&
    entry.expiresAt <= now &&
    (entry.staleUntil === null || entry.staleUntil > now)
  );
}

function requireRefreshStore(store: CacheStore): CoordinatedCacheStore {
  if (
    !store.acquireRefreshLease ||
    !store.publishRefresh ||
    !store.releaseRefreshLease
  ) {
    throw new Error(
      "Demiurge staleWhileRevalidate requires a cache store with acquireRefreshLease, publishRefresh, and releaseRefreshLease coordination methods.",
    );
  }

  return store as CoordinatedCacheStore;
}

async function refreshStaleEntry<TResult>(options: {
  key: string;
  now: () => number;
  onBackgroundError: ((error: unknown) => void) | undefined;
  refreshStore: CoordinatedCacheStore;
  request: CacheRequest<TResult>;
  tags: readonly string[];
  token: string;
}) {
  try {
    const result = await options.request.fn();
    const currentTime = options.now();
    await options.refreshStore.publishRefresh(options.key, options.token, {
      expiresAt: storeExpirationTime(currentTime, options.request.ttl),
      staleUntil: storeStaleTime(
        currentTime,
        options.request.ttl,
        options.request.staleWhileRevalidate,
      ),
      tags: options.tags,
      value: result,
    });
  } catch (error) {
    if (options.onBackgroundError) {
      options.onBackgroundError(error);
    } else {
      console.error("Demiurge stale cache refresh failed.", error);
    }
  } finally {
    await options.refreshStore.releaseRefreshLease(options.key, options.token);
  }
}

function validateNamespacePart(name: string, value: string) {
  const containsControlCharacter = [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });

  if (
    !value ||
    value.trim() !== value ||
    value.includes(":") ||
    containsControlCharacter
  ) {
    throw new Error(
      `Demiurge cache namespace ${name} must be non-empty and cannot contain whitespace padding, colons, or control characters.`,
    );
  }

  return value;
}

function deleteMatchingRequestTags(
  entries: Map<string, RequestCacheEntry<unknown>>,
  tags: Set<string>,
) {
  let deleted = 0;

  for (const [key, entry] of entries) {
    if (entry.tags.some((entryTag) => tags.has(entryTag))) {
      entries.delete(key);
      deleted += 1;
    }
  }

  return deleted;
}

function stableSerialize(value: CacheKeyPart, ancestors: Set<object>): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new Error(
        "Demiurge cache keys require finite numbers and do not accept negative zero.",
      );
    }

    return JSON.stringify(value);
  }

  if (typeof value !== "object") {
    throw new Error(
      `Demiurge cache keys do not accept values of type ${typeof value}.`,
    );
  }

  if (ancestors.has(value)) {
    throw new Error("Demiurge cache keys cannot contain circular references.");
  }

  ancestors.add(value);

  if (Array.isArray(value)) {
    const ownKeys = Reflect.ownKeys(value);
    const expectedKeys = [
      ...Array.from({ length: value.length }, (_, index) => String(index)),
      "length",
    ];

    if (
      ownKeys.length !== expectedKeys.length ||
      ownKeys.some((key, index) => key !== expectedKeys[index]) ||
      expectedKeys.slice(0, -1).some((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return !descriptor?.enumerable || !("value" in descriptor);
      })
    ) {
      ancestors.delete(value);
      throw new Error(
        "Demiurge cache key arrays must be dense and cannot contain accessors or custom properties.",
      );
    }

    const serialized = `[${value
      .map((part) => stableSerialize(part, ancestors))
      .join(",")}]`;
    ancestors.delete(value);
    return serialized;
  }

  const prototype = Object.getPrototypeOf(value);

  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(
      "Demiurge cache keys accept only primitives, arrays, and plain objects.",
    );
  }

  const ownKeys = Reflect.ownKeys(value);

  if (
    ownKeys.some((key) => typeof key === "symbol") ||
    ownKeys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !descriptor?.enumerable || !("value" in descriptor);
    })
  ) {
    throw new Error(
      "Demiurge cache key objects require enumerable string data properties.",
    );
  }

  const objectValue = value as { readonly [key: string]: CacheKeyPart };
  const serialized = `{${Object.keys(objectValue)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableSerialize(objectValue[key], ancestors)}`,
    )
    .join(",")}}`;
  ancestors.delete(value);
  return serialized;
}
