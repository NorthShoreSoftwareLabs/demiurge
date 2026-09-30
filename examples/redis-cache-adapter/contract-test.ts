import { verifyCacheStoreContract } from "@demiurgejs/core/data/testing";
import {
  createCache,
  tag,
  type CacheStore,
  type CacheStoreEntry,
} from "@demiurgejs/core";
import { Redis } from "ioredis";
import { createApplicationRedisStore } from "./src/cache-store.server";

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const falseClaimOnly = process.argv.includes("--false-claim-only");

await verifyFalseAtomicityClaimFails();

if (!falseClaimOnly) {
  const client = new Redis(redisUrl, { lazyConnect: true });
  try {
    await client.connect();
    await verifyCacheStoreContract(() => createApplicationRedisStore(client));
    await verifyNamespaceIsolation(client);
    console.log("Redis extension contracts passed.");
  } finally {
    client.disconnect();
  }
}

async function verifyNamespaceIsolation(client: Redis) {
  const store = createApplicationRedisStore(client);
  const production = createCache({
    namespace: { app: "extension-contract", environment: "production", schemaVersion: 1 },
    store,
  });
  const staging = createCache({
    namespace: { app: "extension-contract", environment: "staging", schemaVersion: 1 },
    store,
  });
  const request = (value: string) => ({
    fn: async () => value,
    key: ["shared-key"],
    scope: "public" as const,
    tags: [tag("shared-tag")],
  });

  const productionValue = await production.get(request("production"));
  const stagingValue = await staging.get(request("staging"));
  if (productionValue !== "production" || stagingValue !== "staging") {
    throw new Error("The application store did not isolate cache namespaces.");
  }

  await production.invalidateTags([tag("shared-tag")]);
  const retained = await staging.get(request("staging-reloaded"));
  if (retained !== "staging") {
    throw new Error("Tag invalidation crossed an application cache namespace.");
  }
}

async function verifyFalseAtomicityClaimFails() {
  let entry: CacheStoreEntry | undefined;
  const dishonestStore = (): CacheStore => ({
    capabilities: { atomicity: "strong" },
    delete() {
      const existed = entry !== undefined;
      entry = undefined;
      return existed;
    },
    get() {
      return entry;
    },
    async invalidateTags(tags) {
      const matched = entry?.tags.some((tag) => tags.includes(tag)) ?? false;
      await new Promise((resolvePromise) => setImmediate(resolvePromise));
      if (matched) entry = undefined;
      return matched ? 1 : 0;
    },
    set(_key, value) {
      entry = value;
    },
  });

  let failure = "";
  try {
    await verifyCacheStoreContract(dishonestStore);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  if (!failure.includes("strong atomicity")) {
    throw new Error("The cache conformance suite accepted a false atomicity claim.");
  }
}
