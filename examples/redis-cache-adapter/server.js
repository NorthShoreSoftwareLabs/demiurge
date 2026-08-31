/* global process, Response, URL */

import { createCache, createInvalidation, tag } from "@demiurgejs/core";
import { serveNodeBuild } from "@demiurgejs/core/node";
import { createRedisCacheStore } from "@demiurgejs/core/redis";
import { Redis } from "ioredis";
import { createHandler } from "./dist/server/server-entry.js";

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const client = new Redis(redisUrl, { lazyConnect: true });
await client.connect();

const namespace = {
  app: "demiurge-redis-cache-adapter",
  environment: process.env.NODE_ENV ?? "development",
  schemaVersion: 1,
};
const store = createRedisCacheStore({ client });
// The framework builds a fresh Cache facade over this same store for every
// request. This second Cache, built here once, shares the store and
// namespace so its invalidateTags(...) call reaches the same Redis entries.
const invalidation = createInvalidation(createCache({ namespace, store }));

await serveNodeBuild({
  base: import.meta.url,
  createHandler({ page, waitUntil }) {
    const applicationHandler = createHandler({
      ...page,
      cacheStore: { namespace, store, waitUntil },
    });

    return async (request) => {
      const url = new URL(request.url);

      if (request.method === "POST" && url.pathname === "/api/invalidate") {
        const body = await request.json();
        const result = await invalidation.tag(tag(body.tag));
        return Response.json(result);
      }

      return applicationHandler(request);
    };
  },
  name: "Demiurge Redis cache adapter",
  port: 4210,
});
