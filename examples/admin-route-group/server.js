/* global console, process, Response, URL */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeServer, renderNodePageResponse } from "@demiurgejs/core/node";
import { createHandler } from "./dist/server/server-entry.js";

const root = fileURLToPath(new URL("dist/client", import.meta.url));
const manifest = JSON.parse(
  await readFile(join(root, "demiurge-manifest.json"), "utf8"),
);
const applicationHandler = createHandler({
  clientEntry: manifest.clientEntry,
  renderPage: renderNodePageResponse,
  styles: manifest.styles,
});
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 4175);
const server = createNodeServer({
  allowedHosts: [host, "localhost"],
  handler: (request) => {
    if (new URL(request.url).pathname === "/.well-known/ready") {
      return new Response(server.isReady() ? "ready" : "draining", {
        status: server.isReady() ? 200 : 503,
      });
    }

    return applicationHandler(request);
  },
  static: { root },
});

server.listen(port, host, () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  console.log(`Demiurge admin route group listening on http://${host}:${actualPort}`);
});
