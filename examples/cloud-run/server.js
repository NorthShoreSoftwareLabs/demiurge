/* global console, process, Response, URL */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMemoryCacheStore } from "@demiurgejs/core";
import {
  createNodeServer,
  createStaticFileHandler,
  renderNodePageResponse,
} from "@demiurgejs/core/node";
import { createHandler } from "./dist/server/server-entry.js";

const root = fileURLToPath(new URL("dist/client", import.meta.url));
const manifest = JSON.parse(
  await readFile(join(root, "demiurge-manifest.json"), "utf8"),
);
const cacheStore = createMemoryCacheStore();
let server;
const reportBackgroundError = (error) => {
  console.error("Demiurge Cloud Run background task failed.", error);
};
const applicationHandler = createHandler({
  cacheStore: {
    namespace: {
      app: "demiurge-cloud-run-example",
      environment: process.env.NODE_ENV ?? "development",
      schemaVersion: 1,
    },
    onBackgroundError: reportBackgroundError,
    store: cacheStore,
    waitUntil(promise) {
      server.waitUntil(promise);
    },
  },
  clientEntry: manifest.clientEntry,
  renderPage: renderNodePageResponse,
  styles: manifest.styles,
});
// Cloud Run injects PORT and expects the container to bind 0.0.0.0. Binding a
// loopback address would leave the platform unable to reach the process.
const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 8080);
const allowedHosts = (process.env.ALLOWED_HOSTS ?? "localhost")
  .split(",")
  .map((value) => value.trim());
const serveStatic = createStaticFileHandler({ root });
const handler = (request) => {
  if (new URL(request.url).pathname === "/.well-known/ready") {
    return new Response(server?.isReady() ? "ready" : "draining", {
      status: server?.isReady() ? 200 : 503,
    });
  }

  return applicationHandler(request);
};

server = createNodeServer({
  allowedHosts,
  handler,
  shutdown: {
    gracePeriod: 30_000,
    onBackgroundError: reportBackgroundError,
    onStateChange(state) {
      console.log(`Demiurge Cloud Run server state: ${state}`);
    },
    signals: ["SIGINT", "SIGTERM"],
  },
  static: serveStatic,
});
server.listen(port, host, () => {
  const address = server.address();
  console.log(
    `Demiurge Cloud Run server listening on http://${host}:${address.port}`,
  );
});
