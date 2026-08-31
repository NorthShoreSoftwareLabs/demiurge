/* global process */

import { createMemoryCacheStore } from "@demiurgejs/core";
import { serveNodeBuild } from "@demiurgejs/core/node";
import { createHandler } from "./dist/server/server-entry.js";

await serveNodeBuild({
  base: import.meta.url,
  createHandler: ({ page, waitUntil }) =>
    createHandler({
      ...page,
      cacheStore: {
        namespace: {
          app: "demiurge-runtime-server-data",
          environment: process.env.NODE_ENV ?? "development",
          schemaVersion: 1,
        },
        store: createMemoryCacheStore(),
        waitUntil,
      },
    }),
  name: "Demiurge runtime data server",
  port: 4192,
});
