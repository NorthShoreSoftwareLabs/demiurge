/* global console, process, URL */

import { fileURLToPath } from "node:url";
import { createMemoryCacheStore } from "@demiurgejs/core";
import {
  createFontAssetHandler,
  createImageOptimizer,
  createStaticFileHandler,
  serveNodeBuild,
} from "@demiurgejs/core/node";
import { createHandler, fonts, locales } from "./dist/server/server-entry.js";

const reportBackgroundError = (error) => {
  console.error("Demiurge Node background task failed.", error);
};

await serveNodeBuild({
  base: import.meta.url,
  createHandler: ({ page, waitUntil }) =>
    createHandler({
      ...page,
      cacheStore: {
        namespace: {
          app: "demiurge-node-example",
          environment: process.env.NODE_ENV ?? "development",
          schemaVersion: 1,
        },
        onBackgroundError: reportBackgroundError,
        store: createMemoryCacheStore(),
        waitUntil,
      },
      locales,
    }),
  name: "Demiurge Node server",
  port: 4173,
  shutdown: {
    gracePeriod: 30_000,
    onBackgroundError: reportBackgroundError,
    onStateChange(state) {
      console.log(`Demiurge Node server state: ${state}`);
    },
    signals: ["SIGINT", "SIGTERM"],
  },
  // The font handler and the optimizer own the two framework asset paths. Every
  // other path falls through to the plain static file handler, and then to the
  // route pipeline.
  static({ root }) {
    const serveFont = createFontAssetHandler({
      fonts,
      root: fileURLToPath(new URL(".", import.meta.url)),
    });
    const optimizeImage = createImageOptimizer({ root });
    const serveFile = createStaticFileHandler({ root });

    return async (request) =>
      (await serveFont(request)) ?? (await optimizeImage(request)) ??
        serveFile(request);
  },
});
