/* global console, process, Response, URL */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createNodeServer } from "@demiurgejs/core/node";

// This server is not a Demiurge app. It serves one static HTML page from a
// second origin. That page makes a real cross-origin request against the
// API server in server.js.
const indexHtml = await readFile(
  fileURLToPath(new URL("client/index.html", import.meta.url)),
  "utf8",
);
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 4196);

const handler = (request) => {
  const { pathname } = new URL(request.url);

  if (pathname === "/" || pathname === "/index.html") {
    return new Response(indexHtml, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return new Response("Not Found", { status: 404 });
};

createNodeServer({
  allowedHosts: [host, "localhost"],
  handler,
}).listen(port, host, () => {
  console.log(`Demiurge CORS client page listening on http://${host}:${port}`);
});
