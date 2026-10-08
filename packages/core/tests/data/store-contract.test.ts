import { describe, expect, it } from "vitest";
import {
  createCache,
  createMemoryCacheStore,
  defineRuntimeInstrumentation,
  type CacheStore,
} from "@demiurgejs/core";
import {
  verifyCacheStoreContract,
  verifyCacheStoreRefreshContract,
} from "../../src/data/testing";

describe("cache store contract", () => {
  it("reports the atomicity capability", async () => {
    const memoryStore = createMemoryCacheStore();

    expect(memoryStore.capabilities.atomicity).toBe("strong");
  });
  it("is satisfied by the framework memory store", async () => {
    await expect(
      verifyCacheStoreContract(createMemoryCacheStore),
    ).resolves.toBeUndefined();
  });

  it("verifies atomic stale-refresh coordination", async () => {
    await expect(
      verifyCacheStoreRefreshContract(createMemoryCacheStore),
    ).resolves.toBeUndefined();
  });

  it("records bounded store operations and capabilities", async () => {
    const observed: Array<Record<string, unknown>> = [];
    const instrumentation = defineRuntimeInstrumentation({
      startSpan(options) {
        const attributes = { ...options.attributes };
        observed.push(attributes);
        return {
          context: {},
          end() {},
          setAttribute(name, value) {
            attributes[name] = value;
          },
          setStatus() {},
        };
      },
    });
    const cache = createCache({
      namespace: { app: "contract-test", environment: "test", schemaVersion: 1 },
      runtimeInstrumentation: instrumentation,
      store: createMemoryCacheStore(),
    });
    const request = {
      fn: () => "stored-value-secret",
      key: ["key-secret"],
      scope: "public" as const,
    };

    await cache.get(request);
    await cache.invalidateKey(request.key);

    const stores = observed.filter((attributes) =>
      typeof attributes["demiurge.store.operation"] === "string"
    );
    expect(stores.map((attributes) => attributes["demiurge.store.operation"])).toEqual([
      "get",
      "set",
      "delete",
      "delete",
      "delete",
    ]);
    expect(stores.every((attributes) => attributes["demiurge.store.atomicity"] === "strong")).toBe(true);
    expect(JSON.stringify(observed)).not.toContain("key-secret");
    expect(JSON.stringify(observed)).not.toContain("stored-value-secret");
  });

  it("accepts asynchronous adapter methods", async () => {
    await expect(
      verifyCacheStoreContract(async () => asynchronousMemoryStore()),
    ).resolves.toBeUndefined();
  });

  it("reports the violated operation", async () => {
    const brokenStore: CacheStore = {
      capabilities: { atomicity: "best-effort" },
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
    capabilities: store.capabilities,
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
