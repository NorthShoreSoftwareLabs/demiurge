import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";

export type StaticFileHandler = (request: Request) => Promise<Response | null>;

export type StaticFileHandlerOptions = {
  // Receives the file's path relative to `root`, always "/"-separated, so a
  // predicate can distinguish `index.html` from `docs/index.html`.
  exclude?: (path: string) => boolean;
  immutable?: (fileName: string) => boolean;
  prefix?: string;
  root: string;
};

// Returning null rather than a 404 keeps the handler composable: it answers
// "is this request a file I own?" and lets the route pipeline own everything
// else, including the 404 body and the security headers that go with it.
// Traversal attempts answer the same way, because a path outside the root is
// not a file this handler owns.
const contentTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const hashedFileName = /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

// The framework's own build output — the SPA shell and the manifest the Node
// server reads to configure itself — must not be reachable as plain static
// files. Both are meant to be served through the route pipeline (or, for
// `demiurge-manifest.json`, not served publicly at all), because that is
// where `@policy.ts` applies CSP, frame-ancestors, and the other headers a
// raw static response never gets. Only the build's own two files at the root
// are excluded: an app's nested `docs/index.html` is a page it chose to ship.
const defaultExcludedPaths = new Set(["demiurge-manifest.json", "index.html"]);

export function createStaticFileHandler(
  options: StaticFileHandlerOptions,
): StaticFileHandler {
  const root = resolve(options.root);
  const prefix = normalizePrefix(options.prefix);
  const isExcluded = options.exclude ?? defaultExcluded;
  const isImmutable = options.immutable ?? defaultImmutable;

  return async function handleStaticFile(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return null;
    }

    const filePath = resolveFilePath(
      root,
      prefix,
      new URL(request.url).pathname,
    );

    if (!filePath || isExcluded(toRelativePath(root, filePath))) {
      return null;
    }

    const stats = await statFile(filePath);

    if (!stats?.isFile()) {
      return null;
    }

    const headers = new Headers({
      "cache-control": isImmutable(fileNameOf(filePath))
        ? "public, max-age=31536000, immutable"
        : "public, max-age=0, must-revalidate",
      "content-length": String(stats.size),
      "content-type": contentTypeOf(filePath),
      "cross-origin-resource-policy": "same-origin",
      "x-content-type-options": "nosniff",
    });

    if (request.method === "HEAD") {
      return new Response(null, { headers });
    }

    return new Response(
      Readable.toWeb(createReadStream(filePath)) as ReadableStream,
      { headers },
    );
  };
}

function resolveFilePath(root: string, prefix: string, pathname: string) {
  let decoded: string;

  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  // A null byte truncates the path for some syscalls, so a name like
  // "app.js\0.txt" could read a different file than the one that was checked.
  if (decoded.includes("\0")) {
    return null;
  }

  if (prefix) {
    if (!decoded.startsWith(prefix)) {
      return null;
    }

    decoded = decoded.slice(prefix.length - 1);
  }

  if (decoded.endsWith("/")) {
    return null;
  }

  const candidate = resolve(root, `.${decoded}`);

  return candidate.startsWith(`${root}${sep}`) ? candidate : null;
}

async function statFile(filePath: string) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

function normalizePrefix(prefix: string | undefined) {
  if (!prefix || prefix === "/") {
    return "";
  }

  return `/${prefix.replace(/^\/|\/$/g, "")}/`;
}

function defaultImmutable(fileName: string) {
  return hashedFileName.test(fileName);
}

function defaultExcluded(path: string) {
  return defaultExcludedPaths.has(path);
}

function toRelativePath(root: string, filePath: string) {
  return filePath.slice(root.length + 1).split(sep).join("/");
}

function fileNameOf(filePath: string) {
  return filePath.slice(filePath.lastIndexOf(sep) + 1);
}

function contentTypeOf(filePath: string) {
  return (
    contentTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream"
  );
}
