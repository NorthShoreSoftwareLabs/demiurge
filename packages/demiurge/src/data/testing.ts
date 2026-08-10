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
  const alphaTag = `${prefix}:tag:alpha`;
  const betaTag = `${prefix}:tag:beta`;
  const alpha = {
    expiresAt: 10_000,
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
      expiresAt: 20_000,
      tags: [betaTag],
      value: "beta",
    });
    await store.set(gammaKey, {
      expiresAt: 30_000,
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
  } finally {
    await Promise.all([
      store.delete(alphaKey),
      store.delete(betaKey),
      store.delete(gammaKey),
    ]);
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
