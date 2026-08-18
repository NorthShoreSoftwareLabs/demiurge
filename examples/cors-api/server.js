/* global console, process, URL */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeServer, renderNodePageResponse } from "@demiurgejs/core/node";
import { createHandler } from "./dist/server/server-entry.js";

const root = fileURLToPath(new URL("dist/client", import.meta.url));
const manifest = JSON.parse(
  await readFile(join(root, "demiurge-manifest.json"), "utf8"),
);
const handler = createHandler({
  clientEntry: manifest.clientEntry,
  renderPage: renderNodePageResponse,
  styles: manifest.styles,
});
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 4195);
const server = createNodeServer({
  allowedHosts: [host, "localhost"],
  handler,
  static: { root },
});

server.listen(port, host, () => {
  // Port 0 asks the operating system for a free port. Log the bound port so
  // a caller can reach the server.
  const address = server.address();
  console.log(
    `Demiurge CORS API server listening on http://${host}:${address.port}`,
  );
});
