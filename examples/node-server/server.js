/* global console, process, Response, URL */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMemoryCacheStore } from "demiurge";
import { createNodeServer, renderNodePageResponse } from "demiurge/node";
import { createHandler } from "./dist/server/server-entry.js";

const root = fileURLToPath(new URL("dist/client", import.meta.url));
const manifest = JSON.parse(
  await readFile(join(root, "demiurge-manifest.json"), "utf8"),
);
const cacheStore = createMemoryCacheStore();
const applicationHandler = createHandler({
  cacheStore: {
    namespace: {
      app: "demiurge-node-example",
      environment: process.env.NODE_ENV ?? "development",
      schemaVersion: 1,
    },
    store: cacheStore,
  },
  clientEntry: manifest.clientEntry,
  renderPage: renderNodePageResponse,
  styles: manifest.styles,
});
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 4173);
const allowedHosts = (process.env.ALLOWED_HOSTS ?? `${host},localhost`)
  .split(",")
  .map((value) => value.trim());
let server;
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
    onStateChange(state) {
      console.log(`Demiurge Node server state: ${state}`);
    },
    signals: ["SIGINT", "SIGTERM"],
  },
  static: { root },
});
server.listen(port, host, () => {
  console.log(`Demiurge Node server listening on http://${host}:${port}`);
});
