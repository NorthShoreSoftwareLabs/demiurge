import type { CacheStore, CacheStoreEntry } from "./cache";

type MaybePromise<T> = T | Promise<T>;

export type CacheStoreFactory = () => MaybePromise<CacheStore>;

export async function verifyCacheStoreContract(
  createStore: CacheStoreFactory,
) {
  const store = await createStore();
  const prefix = `demiurge-contract:${Date.now()}:${Math.random()}`;
  const alphaKey = `${prefix}:alpha`;
  const betaKey = `${prefix}:beta`;
  const gammaKey = `${prefix}:gamma`;
  const deltaKey = `${prefix}:delta`;
  const alphaTag = `${prefix}:tag:alpha`;
  const betaTag = `${prefix}:tag:beta`;
  const deltaTag = `${prefix}:tag:delta`;
  const future = Date.now() + 60_000;
  const alpha = {
    expiresAt: future,
    staleUntil: future + 5_000,
    tags: [alphaTag],
    value: { id: "alpha", revision: 1 },
  } satisfies CacheStoreEntry;

  try {
    assert(
      await store.get(alphaKey) === undefined,
      "get() must return undefined for a missing key",
    );

    await store.set(alphaKey, alpha);
    assertEntry(await store.get(alphaKey), alpha, "set() then get()");

    const updatedAlpha = {
      ...alpha,
      value: { id: "alpha", revision: 2 },
    } satisfies CacheStoreEntry;
    await store.set(alphaKey, updatedAlpha);
    assertEntry(
      await store.get(alphaKey),
      updatedAlpha,
      "set() must replace an existing key",
    );

    await store.set(betaKey, {
      expiresAt: future + 10_000,
      staleUntil: future + 15_000,
      tags: [betaTag],
      value: "beta",
    });
    await store.set(gammaKey, {
      expiresAt: future + 20_000,
      staleUntil: future + 25_000,
      tags: [alphaTag, betaTag],
      value: ["gamma"],
    });

    assert(
      await store.invalidateTags([alphaTag]) === 2,
      "invalidateTags() must return the number of entries deleted, counting each entry once",
    );
    assert(
      await store.get(alphaKey) === undefined &&
        await store.get(gammaKey) === undefined,
      "invalidateTags() must delete every entry carrying a matching tag",
    );
    assert(
      (await store.get(betaKey))?.value === "beta",
      "invalidateTags() must preserve entries with no matching tag",
    );
    assert(
      await store.delete(betaKey) === true,
      "delete() must report an existing key",
    );
    assert(
      await store.delete(betaKey) === false,
      "delete() must report a missing key",
    );

    // A negative entry (a loader's `cacheNotFound()` result) round-trips
    // like any other entry, and tag invalidation clears it the same way it
    // clears a positive result.
    const delta = {
      expiresAt: future,
      negative: true,
      staleUntil: future,
      tags: [deltaTag],
      value: "not found",
    } satisfies CacheStoreEntry;

    await store.set(deltaKey, delta);
    assertEntry(
      await store.get(deltaKey),
      delta,
      "set() then get() for a negative entry",
    );
    assert(
      await store.invalidateTags([deltaTag]) === 1,
      "invalidateTags() must delete a negative entry carrying a matching tag",
    );
    assert(
      await store.get(deltaKey) === undefined,
      "invalidateTags() must remove a negative entry the same as a positive one",
    );
  } finally {
    await Promise.all([
      store.delete(alphaKey),
      store.delete(betaKey),
      store.delete(gammaKey),
      store.delete(deltaKey),
    ]);
  }
}

export async function verifyCacheStoreRefreshContract(
  createStore: CacheStoreFactory,
) {
  const store = await createStore();
  const prefix = `demiurge-refresh-contract:${Date.now()}:${Math.random()}`;
  const key = `${prefix}:entry`;
  const tag = `${prefix}:tag`;
  const firstToken = `${prefix}:first`;
  const secondToken = `${prefix}:second`;
  const leaseExpiresAt = Date.now() + 60_000;

  assert(
    Boolean(
      store.acquireRefreshLease &&
        store.publishRefresh &&
        store.releaseRefreshLease,
    ),
    "SWR support requires acquireRefreshLease(), publishRefresh(), and releaseRefreshLease()",
  );

  const acquireRefreshLease = store.acquireRefreshLease!;
  const publishRefresh = store.publishRefresh!;
  const releaseRefreshLease = store.releaseRefreshLease!;
  const original = {
    expiresAt: Date.now() - 1,
    staleUntil: Date.now() + 120_000,
    tags: [tag],
    value: "original",
  } satisfies CacheStoreEntry;
  const refreshed = {
    ...original,
    expiresAt: Date.now() + 60_000,
    value: "refreshed",
  } satisfies CacheStoreEntry;

  try {
    await store.set(key, original);
    assert(
      await acquireRefreshLease(key, firstToken, leaseExpiresAt),
      "acquireRefreshLease() must acquire an unowned key",
    );
    assert(
      !await acquireRefreshLease(key, secondToken, leaseExpiresAt),
      "acquireRefreshLease() must exclude a second owner",
    );
    assert(
      !await publishRefresh(key, secondToken, refreshed),
      "publishRefresh() must reject a non-owner token",
    );
    await releaseRefreshLease(key, secondToken);
    assert(
      !await acquireRefreshLease(key, secondToken, leaseExpiresAt),
      "releaseRefreshLease() must not release another owner's lease",
    );
    assert(
      await publishRefresh(key, firstToken, refreshed),
      "publishRefresh() must atomically publish for the current owner",
    );
    assertEntry(
      await store.get(key),
      refreshed,
      "publishRefresh() for the current owner",
    );
    assert(
      await acquireRefreshLease(key, secondToken, leaseExpiresAt),
      "successful publication must release the refresh lease",
    );
    assert(await store.delete(key), "delete() must remove the refreshed entry");
    assert(
      !await publishRefresh(key, secondToken, original),
      "delete() must cancel an in-flight refresh lease",
    );

    await store.set(key, original);
    assert(
      await acquireRefreshLease(key, firstToken, leaseExpiresAt),
      "a lease must be reusable after deletion",
    );
    assert(
      await store.invalidateTags([tag]) === 1,
      "invalidateTags() must remove the leased entry",
    );
    assert(
      !await publishRefresh(key, firstToken, refreshed),
      "tag invalidation must cancel an in-flight refresh lease",
    );
  } finally {
    await store.delete(key);
  }
}

function assertEntry(
  actual: CacheStoreEntry | undefined,
  expected: CacheStoreEntry,
  operation: string,
) {
  assert(Boolean(actual), `${operation} must preserve the entry`);
  assert(
    actual?.expiresAt === expected.expiresAt,
    `${operation} must preserve expiresAt`,
  );
  assert(
    Boolean(actual?.negative) === Boolean(expected.negative),
    `${operation} must preserve the negative flag`,
  );
  assert(
    actual?.staleUntil === expected.staleUntil,
    `${operation} must preserve staleUntil`,
  );
  assert(
    JSON.stringify(actual?.tags) === JSON.stringify(expected.tags),
    `${operation} must preserve tags`,
  );
  assert(
    JSON.stringify(actual?.value) === JSON.stringify(expected.value),
    `${operation} must preserve JSON-compatible values`,
  );
}

function assert(condition: boolean, requirement: string): asserts condition {
  if (!condition) {
    throw new Error(`Cache store contract failed: ${requirement}.`);
  }
}
