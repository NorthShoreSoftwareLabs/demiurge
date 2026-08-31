/* global console, process */

import { createMemoryCacheStore } from "@demiurgejs/core";
import { serveNodeBuild } from "@demiurgejs/core/node";
import { createHandler } from "./dist/server/server-entry.js";

const reportBackgroundError = (error) => {
  console.error("Demiurge VM Node background task failed.", error);
};

await serveNodeBuild({
  base: import.meta.url,
  createHandler: ({ page, waitUntil }) =>
    createHandler({
      ...page,
      cacheStore: {
        namespace: {
          app: "demiurge-vm-node-example",
          environment: process.env.NODE_ENV ?? "development",
          schemaVersion: 1,
        },
        onBackgroundError: reportBackgroundError,
        store: createMemoryCacheStore(),
        waitUntil,
      },
    }),
  // VM and bare-metal deployments bind a loopback address because a reverse
  // proxy sits in front. The proxy terminates TLS and forwards to that address.
  host: process.env.HOST ?? "127.0.0.1",
  name: "Demiurge VM Node server",
  port: 4173,
  shutdown: {
    gracePeriod: 30_000,
    onBackgroundError: reportBackgroundError,
    onStateChange(state) {
      console.log(`Demiurge VM Node server state: ${state}`);
    },
    signals: ["SIGTERM"],
  },
  // Trust exactly one hop from the reverse proxy. The proxy adds
  // X-Forwarded-For, X-Forwarded-Proto, and X-Forwarded-Host headers. This
  // tells the adapter to read the client address from those headers instead of
  // the direct connection.
  trustProxy: { hops: 1 },
});
