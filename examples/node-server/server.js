/* global console, process */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createNodeServer } from "demiurge/node";
import { createHandler } from "./dist/server/server-entry.js";

const root = resolve("dist/client");
const manifest = JSON.parse(
  await readFile(resolve(root, "demiurge-manifest.json"), "utf8"),
);
const handler = createHandler({
  clientEntry: manifest.clientEntry,
  styles: manifest.styles,
});
const port = Number(process.env.PORT ?? 4173);

createNodeServer({
  handler,
  static: { root },
}).listen(port, "127.0.0.1", () => {
  console.log(`Demiurge Node server listening on http://127.0.0.1:${port}`);
});
