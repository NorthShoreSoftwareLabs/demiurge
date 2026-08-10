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
  tags: readonly string[];
  value: unknown;
};

export type CacheStore = {
  delete: (key: string) => MaybePromise<boolean>;
  get: (key: string) => MaybePromise<CacheStoreEntry | undefined>;
  invalidateTags: (tags: readonly string[]) => MaybePromise<number>;
  set: (key: string, entry: CacheStoreEntry) => MaybePromise<void>;
};

export type CreateCacheOptions = {
  namespace: CacheNamespace;
  now?: () => number;
  store: CacheStore;
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
  invalidated: boolean;
  promise: Promise<unknown>;
  tags: readonly string[];
};

export type MemoryCacheOptions = {
  now?: () => number;
};

export type MemoryCacheStoreOptions = {
  entries?: Map<string, CacheStoreEntry>;
};

const sharedScopes = ["build", "private", "public"] as const;
const memoryNamespace = {
  app: "demiurge-memory",
  environment: "local",
  schemaVersion: 1,
} satisfies CacheNamespace;

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
      const existing = await options.store.get(key);

      if (
        existing &&
        (existing.expiresAt === null || existing.expiresAt > now())
      ) {
        return existing.value as TResult;
      }

      if (existing) {
        await options.store.delete(key);
      }

      const currentPending = sharedPending.get(key);

      if (currentPending) {
        return await currentPending.promise as TResult;
      }

      const tags = (request.tags ?? []).map((value) =>
        serializeStoreTag(namespace, scope, serializeCacheTag(value))
      );
      const pending = {
        invalidated: false,
        promise: undefined as unknown as Promise<TResult>,
        tags,
      } satisfies PendingStoreEntry;
      const value = Promise.resolve().then(request.fn).then(async (result) => {
        if (!pending.invalidated) {
          await options.store.set(key, {
            expiresAt: storeExpirationTime(now(), request.ttl),
            tags,
            value: result,
          });
        }

        return result;
      });
      pending.promise = value;
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
            pending.invalidated = true;
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
          !pending.invalidated &&
          pending.tags.some((value) => storeTags.has(value))
        ) {
          pending.invalidated = true;
          deletedPending += 1;
        }
      }

      const deletedShared = await options.store.invalidateTags([...storeTags]);

      return deletedRequest + deletedPending + deletedShared;
    },
  };
}

export function createMemoryCache(options: MemoryCacheOptions = {}): Cache {
  return createCache({
    namespace: memoryNamespace,
    now: options.now,
    store: createMemoryCacheStore(),
  });
}

export function createMemoryCacheStore(
  options: MemoryCacheStoreOptions = {},
): CacheStore {
  const entries = options.entries ?? new Map<string, CacheStoreEntry>();

  return {
    delete(key) {
      return entries.delete(key);
    },
    get(key) {
      return entries.get(key);
    },
    invalidateTags(tags) {
      const serializedTags = new Set(tags);
      let deleted = 0;

      for (const [key, entry] of entries) {
        if (entry.tags.some((value) => serializedTags.has(value))) {
          entries.delete(key);
          deleted += 1;
        }
      }

      return deleted;
    },
    set(key, entry) {
      entries.set(key, entry);
    },
  };
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
  return stableSerialize(key);
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

function stableSerialize(value: CacheKeyPart): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }

  const objectValue = value as { readonly [key: string]: CacheKeyPart };

  return `{${Object.keys(objectValue)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(objectValue[key])}`)
    .join(",")}}`;
}
