/* global console, process, URL */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeServer } from "demiurge/node";
import { createHandler } from "./dist/server/server-entry.js";

const root = fileURLToPath(new URL("dist/client", import.meta.url));
const manifest = JSON.parse(
  await readFile(join(root, "demiurge-manifest.json"), "utf8"),
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
