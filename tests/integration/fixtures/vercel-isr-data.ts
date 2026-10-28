import assert from "node:assert/strict";
import {
  createCache,
  createMemoryCacheStore,
  tag,
  type CacheRequest,
  type CacheStoreEntry,
} from "@demiurgejs/core";

const namespace = {
  app: "vercel-isr-proof",
  environment: "local",
  schemaVersion: 1,
};

export async function verifyFreshGenerationData(): Promise<void> {
  const sharedEntries = new Map<string, CacheStoreEntry>();
  const sharedStore = createMemoryCacheStore({ entries: sharedEntries });
  const shared = createCache({ namespace, store: sharedStore });
  let version = 1;
  let reads = 0;
  const product = (id: string): CacheRequest<string> => ({
    key: ["product", id],
    tags: [tag("products")],
    scope: "public",
    fn: () => {
      reads += 1;
      return `${id}:${version}`;
    },
  });

  assert.equal(await shared.get(product("alpha")), "alpha:1");
  version = 2;
  assert.equal(await shared.get(product("alpha")), "alpha:1");
  assert.equal(reads, 1);

  const beforeGeneration = [...sharedEntries];
  const generation = createCache({ namespace, store: createMemoryCacheStore() });
  assert.deepEqual(await Promise.all([
    generation.get(product("alpha")),
    generation.get(product("alpha")),
  ]), ["alpha:2", "alpha:2"]);
  assert.equal(await generation.get(product("alpha")), "alpha:2");
  assert.equal(reads, 2);
  assert.equal(await generation.get(product("beta")), "beta:2");
  assert.equal(reads, 3);
  assert.deepEqual([...sharedEntries], beforeGeneration);

  const started = barrier();
  const release = barrier();
  const pending = generation.get({
    ...product("pending"),
    fn: async () => {
      const captured = version;
      started.resolve();
      await release.promise;
      return `pending:${captured}`;
    },
  });
  await started.promise;
  version = 3;
  await shared.invalidateTags([tag("products")]);
  assert.equal(sharedEntries.size, 0);
  release.resolve();
  assert.equal(await pending, "pending:2");
  assert.equal(sharedEntries.size, 0);
  assert.equal(await shared.get(product("alpha")), "alpha:3");

  const nextGeneration = createCache({ namespace, store: createMemoryCacheStore() });
  assert.equal(await nextGeneration.get(product("alpha")), "alpha:3");

  const contributionNames = ["page", "layout", "metadata", "document"];
  const contribution = (name: string): CacheRequest<number> => ({
    key: ["contribution", name], scope: "public", fn: () => { reads++; return version; },
  });
  for (const name of contributionNames) assert.equal(await shared.get(contribution(name)), 3);
  const beforeContributions = [...sharedEntries];
  version = 4;
  for (const name of contributionNames) assert.equal(await shared.get(contribution(name)), 3);
  const freshContributions = createCache({ namespace, store: createMemoryCacheStore() });
  const beforeReads = reads;
  for (const name of contributionNames) {
    assert.deepEqual(await Promise.all([
      freshContributions.get(contribution(name)),
      freshContributions.get(contribution(name)),
    ]), [4, 4]);
  }
  assert.equal(reads, beforeReads + contributionNames.length);
  assert.deepEqual([...sharedEntries], beforeContributions);

  // Separate representation reads do not establish a source snapshot.
  const representation = () => createCache({ namespace, store: createMemoryCacheStore() });
  version = 3;
  const documentVersion = await representation().get(product("alpha"));
  version = 4;
  const navigationVersion = await representation().get(product("alpha"));
  assert.equal(documentVersion, "alpha:3");
  assert.equal(navigationVersion, "alpha:4");
  assert.notEqual(documentVersion, navigationVersion);
}

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
