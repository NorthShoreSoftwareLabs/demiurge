import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

type StaticEntry = {
  file: string;
  headers: Record<string, string>;
  pathname: string;
  status: number;
};

type StaticManifest = {
  entries: StaticEntry[];
};

const host = "localhost";
const port = 42178;
const outputRoot = resolve("examples/static-export/dist");
const manifest = JSON.parse(
  await readFile(resolve(outputRoot, "demiurge-static-manifest.json"), "utf8"),
) as StaticManifest;
const entries = new Map(
  manifest.entries.map((entry) => [entry.pathname, entry]),
);

function contentType(pathname: string) {
  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
  }[extname(pathname)];
}

function assetFile(pathname: string) {
  const file = resolve(outputRoot, `.${pathname}`);

  if (file !== outputRoot && !file.startsWith(`${outputRoot}${sep}`)) {
    throw new Error("The static request path is outside the output directory.");
  }

  return file;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    const pathname = decodeURIComponent(url.pathname).replace(/\/$/, "") || "/";
    const entry = entries.get(pathname);

    if (entry) {
      for (const [name, value] of Object.entries(entry.headers)) {
        response.setHeader(name, value);
      }
      response.writeHead(entry.status);
      response.end(request.method === "HEAD"
        ? undefined
        : await readFile(resolve(outputRoot, entry.file)));
      return;
    }

    if (pathname.startsWith("/assets/")) {
      const type = contentType(pathname);

      if (type) {
        response.setHeader("content-type", type);
      }
      response.writeHead(200);
      response.end(request.method === "HEAD"
        ? undefined
        : await readFile(assetFile(pathname)));
      return;
    }

    const fallback = entries.get("*");

    if (!fallback) {
      throw new Error("The static manifest does not contain a fallback.");
    }
    for (const [name, value] of Object.entries(fallback.headers)) {
      response.setHeader(name, value);
    }
    response.writeHead(fallback.status);
    response.end(request.method === "HEAD"
      ? undefined
      : await readFile(resolve(outputRoot, fallback.file)));
  } catch {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("The static test server could not serve the request.");
  }
});

server.listen(port, host);

function closeServer() {
  server.close();
}

process.once("SIGINT", closeServer);
process.once("SIGTERM", closeServer);
