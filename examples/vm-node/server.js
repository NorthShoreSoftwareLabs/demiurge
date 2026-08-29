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
  console.error("Demiurge VM Node background task failed.", error);
};
const applicationHandler = createHandler({
  cacheStore: {
    namespace: {
      app: "demiurge-vm-node-example",
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
// VM/bare-metal binds to a loopback address since a reverse proxy sits in front.
// The proxy terminates TLS and forwards to this loopback address.
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 4173);
const allowedHosts = (process.env.ALLOWED_HOSTS ?? `${host},localhost`)
  .split(",")
  .map((value) => value.trim());
// Trust exactly one hop from the reverse proxy. The proxy adds X-Forwarded-For,
// X-Forwarded-Proto, and X-Forwarded-Host headers. This tells the adapter to
// read the client IP from those headers instead of the direct connection.
const trustProxy = { hops: 1 };
const serveFile = createStaticFileHandler({ root });
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
  trustProxy,
  shutdown: {
    gracePeriod: 30_000,
    onBackgroundError: reportBackgroundError,
    onStateChange(state) {
      console.log(`Demiurge VM Node server state: ${state}`);
    },
    signals: ["SIGTERM"],
  },
  static: serveFile,
});
server.listen(port, host, () => {
  const address = server.address();
  console.log(
    `Demiurge VM Node server listening on http://${host}:${address.port}`,
  );
});
