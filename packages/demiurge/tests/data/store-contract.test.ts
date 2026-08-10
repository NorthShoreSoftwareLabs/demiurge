import { describe, expect, it } from "vitest";
import { createMemoryCacheStore, type CacheStore } from "demiurge";
import { verifyCacheStoreContract } from "../../src/data/testing";

describe("cache store contract", () => {
  it("is satisfied by the framework memory store", async () => {
    await expect(
      verifyCacheStoreContract(createMemoryCacheStore),
    ).resolves.toBeUndefined();
  });

  it("accepts asynchronous adapter methods", async () => {
    await expect(
      verifyCacheStoreContract(async () => asynchronousMemoryStore()),
    ).resolves.toBeUndefined();
  });

  it("reports the violated operation", async () => {
    const brokenStore: CacheStore = {
      delete: () => false,
      get: () => undefined,
      invalidateTags: () => 0,
      set: () => undefined,
    };

    await expect(
      verifyCacheStoreContract(() => brokenStore),
    ).rejects.toThrow(
      "Cache store contract failed: set() then get() must preserve the entry.",
    );
  });
});

function asynchronousMemoryStore(): CacheStore {
  const store = createMemoryCacheStore();

  return {
    async delete(key) {
      return await store.delete(key);
    },
    async get(key) {
      return await store.get(key);
    },
    async invalidateTags(tags) {
      return await store.invalidateTags(tags);
    },
    async set(key, entry) {
      await store.set(key, entry);
    },
  };
}
