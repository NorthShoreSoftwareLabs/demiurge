/* global console, process */

import { createMemoryCacheStore } from "@demiurgejs/core";
import { serveNodeBuild } from "@demiurgejs/core/node";
import { createHandler } from "./dist/server/server-entry.js";

await serveNodeBuild({
  base: import.meta.url,
  createHandler: ({ page, waitUntil }) => createHandler({
    ...page,
    cacheStore: {
      namespace: {
        app: "demiurge-adversarial-security",
        environment: process.env.NODE_ENV ?? "development",
        schemaVersion: 1,
      },
      onBackgroundError: (error) => console.error(error),
      store: createMemoryCacheStore(),
      waitUntil,
    },
  }),
  host: process.env.HOST ?? "127.0.0.1",
  name: "Demiurge adversarial security fixture",
  port: Number(process.env.PORT ?? 4193),
  trustProxy: false,
});
