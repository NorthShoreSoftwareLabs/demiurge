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
  invalidateKey: (key: CacheKey) => boolean;
  invalidateTags: (tags: readonly CacheTag[]) => number;
};

type CacheEntry<TResult> = {
  expiresAt: number;
  scope: CacheScope;
  tags: readonly string[];
  value: Promise<TResult>;
};

type MemoryCacheOptions = {
  now?: () => number;
};

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

export function defineTags<TTags extends Record<string, (...args: never[]) => CacheTag>>(
  tags: TTags,
) {
  return tags;
}

export function createMemoryCache(options: MemoryCacheOptions = {}): Cache {
  const now = options.now ?? Date.now;
  const sharedEntries = new Map<string, CacheEntry<unknown>>();
  const requestEntries = new Map<string, CacheEntry<unknown>>();

  return {
    async get<TResult>(request: CacheRequest<TResult>) {
      const scope = request.scope ?? "request";

      if (scope === "none") {
        return await request.fn();
      }

      const entries = scope === "request" ? requestEntries : sharedEntries;
      const key = serializeCacheKey(request.key);
      const existing = entries.get(key);

      if (existing && existing.expiresAt > now()) {
        return await (existing.value as Promise<TResult>);
      }

      const value = Promise.resolve().then(request.fn);
      const entry = {
        expiresAt: now() + parseCacheDuration(request.ttl),
        scope,
        tags: (request.tags ?? []).map(serializeCacheTag),
        value,
      } satisfies CacheEntry<TResult>;

      entries.set(key, entry);

      try {
        return await value;
      } catch (error) {
        if (entries.get(key) === entry) {
          entries.delete(key);
        }

        throw error;
      }
    },
    invalidateKey(key: CacheKey) {
      const serializedKey = serializeCacheKey(key);
      const deletedShared = sharedEntries.delete(serializedKey);
      const deletedRequest = requestEntries.delete(serializedKey);

      return deletedShared || deletedRequest;
    },
    invalidateTags(tags: readonly CacheTag[]) {
      const serializedTags = new Set(tags.map(serializeCacheTag));
      let deleted = 0;

      deleted += deleteMatchingTags(sharedEntries, serializedTags);
      deleted += deleteMatchingTags(requestEntries, serializedTags);

      return deleted;
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

function deleteMatchingTags(
  entries: Map<string, CacheEntry<unknown>>,
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
