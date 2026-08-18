/* global console, process, Response, URL */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCache, createInvalidation, tag } from "@demiurgejs/core";
import { createNodeServer, renderNodePageResponse } from "@demiurgejs/core/node";
import { createRedisCacheStore } from "@demiurgejs/core/redis";
import { Redis } from "ioredis";
import { createHandler } from "./dist/server/server-entry.js";

const root = fileURLToPath(new URL("dist/client", import.meta.url));
const manifest = JSON.parse(
  await readFile(join(root, "demiurge-manifest.json"), "utf8"),
);

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
const applicationHandler = createHandler({
  cacheStore: { namespace, store },
  clientEntry: manifest.clientEntry,
  renderPage: renderNodePageResponse,
  styles: manifest.styles,
});

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 4210);

const handler = async (request) => {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/api/invalidate") {
    const body = await request.json();
    const result = await invalidation.tag(tag(body.tag));
    return Response.json(result);
  }

  return applicationHandler(request);
};

const server = createNodeServer({
  allowedHosts: [host, "localhost"],
  handler,
  static: { root },
});

server.listen(port, host, () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  console.log(
    `Demiurge Redis cache adapter listening on http://${host}:${actualPort}`,
  );
});
