import { resolve } from "node:path";
import { createMemoryCacheStore } from "@demiurgejs/core";
import {
  createFontAssetHandler,
  createImageOptimizer,
  createStaticFileHandler,
  type NodeBuildContext,
} from "@demiurgejs/core/node";
import { createHandler as createDemiurgeHandler, routes } from "virtual:demiurge/server-entry";
import { fonts } from "./fonts";

export { routes };

const reportBackgroundError = (error: unknown) => {
  console.error("Demiurge Node background task failed.", error);
};

export function createHandler({ page, waitUntil }: NodeBuildContext) {
  return createDemiurgeHandler({
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
  });
}

export function createStatic({ root }: NodeBuildContext) {
  const serveFont = createFontAssetHandler({
    fonts,
    root: resolve(root, "..", ".."),
  });
  const optimizeImage = createImageOptimizer({ root });
  const serveFile = createStaticFileHandler({ root });

  return async (request: Request) =>
    (await serveFont(request)) ?? (await optimizeImage(request)) ??
      serveFile(request);
}
