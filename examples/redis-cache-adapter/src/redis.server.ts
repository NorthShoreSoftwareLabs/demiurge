import "@demiurgejs/core/server-only";
import {
  createCache,
  createInvalidation,
  tag,
} from "@demiurgejs/core";
import { Redis } from "ioredis";
import { createApplicationRedisStore } from "./cache-store.server";

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
export const redis = new Redis(redisUrl, { lazyConnect: true });
await redis.connect();

const queueKey = "demiurge-example:jobs";

export const namespace = {
  app: "demiurge-redis-cache-adapter",
  environment: process.env.NODE_ENV ?? "development",
  schemaVersion: 1,
};
export const store = createApplicationRedisStore(redis);
const invalidation = createInvalidation(createCache({ namespace, store }));

export async function invalidatePostTag(tagId: string) {
  return await invalidation.tag(tag(tagId));
}

export async function enqueueJob(payload: unknown) {
  const job = JSON.stringify({ payload, queuedAt: Date.now() });
  await redis.lpush(queueKey, job);
  return { queued: true } as const;
}

export const applicationQueueKey = queueKey;
