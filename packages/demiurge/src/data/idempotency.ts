import {
  parseCacheDuration,
  serializeCacheKey,
  type CacheDuration,
  type CacheKey,
} from "./cache";

type MaybePromise<T> = T | Promise<T>;

export type IdempotencyRequest<TResult> = {
  fn: () => MaybePromise<TResult>;
  key: CacheKey;
  ttl?: CacheDuration;
};

export type IdempotencyResult<TResult> = {
  key: string;
  replayed: boolean;
  value: TResult;
};

export type IdempotencyStore = {
  run: <TResult>(
    request: IdempotencyRequest<TResult>,
  ) => Promise<IdempotencyResult<TResult>>;
};

type IdempotencyEntry<TResult> = {
  expiresAt: number;
  pending: boolean;
  value: Promise<TResult>;
};

export type MemoryIdempotencyStoreOptions = {
  defaultTtl?: CacheDuration;
  maximumEntries?: number;
  now?: () => number;
};

const defaultIdempotencyTtl = "24h";
const defaultMaximumEntries = 10_000;

export function createMemoryIdempotencyStore(
  options: MemoryIdempotencyStoreOptions = {},
): IdempotencyStore {
  const now = options.now ?? Date.now;
  const defaultTtl = options.defaultTtl ?? defaultIdempotencyTtl;
  const maximumEntries = options.maximumEntries ?? defaultMaximumEntries;

  if (!Number.isSafeInteger(maximumEntries) || maximumEntries <= 0) {
    throw new Error(
      "Demiurge idempotency maximumEntries must be a positive integer.",
    );
  }

  const defaultTtlMs = parseCacheDuration(defaultTtl);

  if (!Number.isFinite(defaultTtlMs)) {
    throw new Error("Demiurge idempotency defaultTtl must be finite.");
  }

  const entries = new Map<string, IdempotencyEntry<unknown>>();

  return {
    async run<TResult>(request: IdempotencyRequest<TResult>) {
      const key = serializeCacheKey(request.key);
      const currentTime = now();
      sweepExpiredIdempotencyEntries(entries, currentTime);
      const existing = entries.get(key);

      if (existing && (existing.pending || existing.expiresAt > currentTime)) {
        return {
          key,
          replayed: true,
          value: await (existing.value as Promise<TResult>),
        };
      }

      if (entries.size >= maximumEntries) {
        evictOldestCompletedIdempotencyEntry(entries);
      }

      if (entries.size >= maximumEntries) {
        throw new Error(
          "Demiurge idempotency store is at capacity with in-flight mutations.",
        );
      }

      const value = Promise.resolve().then(request.fn);
      const entry: IdempotencyEntry<TResult> = {
        expiresAt: Number.POSITIVE_INFINITY,
        pending: true,
        value,
      };

      entries.set(key, entry);

      try {
        const result = await value;
        entry.pending = false;
        entry.expiresAt = now() + parseCacheDuration(request.ttl ?? defaultTtl);

        return {
          key,
          replayed: false,
          value: result,
        };
      } catch (error) {
        if (entries.get(key) === entry) {
          entries.delete(key);
        }

        throw error;
      }
    },
  };
}

function sweepExpiredIdempotencyEntries(
  entries: Map<string, IdempotencyEntry<unknown>>,
  now: number,
) {
  for (const [key, entry] of entries) {
    if (!entry.pending && entry.expiresAt <= now) {
      entries.delete(key);
    }
  }
}

function evictOldestCompletedIdempotencyEntry(
  entries: Map<string, IdempotencyEntry<unknown>>,
) {
  for (const [key, entry] of entries) {
    if (!entry.pending) {
      entries.delete(key);
      return;
    }
  }
}

export function runIdempotentMutation<TResult>(
  store: IdempotencyStore,
  request: IdempotencyRequest<TResult>,
) {
  return store.run(request);
}
