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
  value: Promise<TResult>;
};

type MemoryIdempotencyStoreOptions = {
  now?: () => number;
};

export function createMemoryIdempotencyStore(
  options: MemoryIdempotencyStoreOptions = {},
): IdempotencyStore {
  const now = options.now ?? Date.now;
  const entries = new Map<string, IdempotencyEntry<unknown>>();

  return {
    async run<TResult>(request: IdempotencyRequest<TResult>) {
      const key = serializeCacheKey(request.key);
      const existing = entries.get(key);

      if (existing && existing.expiresAt > now()) {
        return {
          key,
          replayed: true,
          value: await (existing.value as Promise<TResult>),
        };
      }

      const value = Promise.resolve().then(request.fn);
      const entry = {
        expiresAt: now() + parseCacheDuration(request.ttl),
        value,
      } satisfies IdempotencyEntry<TResult>;

      entries.set(key, entry);

      try {
        return {
          key,
          replayed: false,
          value: await value,
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

export function runIdempotentMutation<TResult>(
  store: IdempotencyStore,
  request: IdempotencyRequest<TResult>,
) {
  return store.run(request);
}
