import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
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
  const realRoot = realpath(root);
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

    const opened = await openStaticFile(root, await safeRealRoot(realRoot), filePath);

    if (!opened) {
      return null;
    }

    const { file, stats } = opened;

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
      await file.close();
      return new Response(null, { headers });
    }

    return new Response(
      Readable.toWeb(file.createReadStream()) as ReadableStream,
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

async function safeRealRoot(root: Promise<string>) {
  try {
    return await root;
  } catch {
    return null;
  }
}

async function openStaticFile(
  root: string,
  realRoot: string | null,
  filePath: string,
) {
  if (!realRoot || !(await hasNoSymlinkComponents(root, filePath))) {
    return null;
  }

  let resolvedTarget: string;

  try {
    resolvedTarget = await realpath(filePath);
  } catch {
    return null;
  }

  if (!isPathInside(realRoot, resolvedTarget)) {
    return null;
  }

  const noFollow =
    typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  let file: Awaited<ReturnType<typeof open>>;

  try {
    // O_NOFOLLOW closes the final-component race on platforms that expose it.
    // The component walk and realpath containment check cover directory links.
    file = await open(filePath, constants.O_RDONLY | noFollow);
  } catch {
    return null;
  }

  try {
    const stats = await file.stat();

    if (!stats.isFile()) {
      await file.close();
      return null;
    }

    return { file, stats };
  } catch {
    await file.close();
    return null;
  }
}

async function hasNoSymlinkComponents(root: string, filePath: string) {
  const parts = relative(root, filePath).split(sep);
  let current = root;

  try {
    for (const part of parts) {
      current = join(current, part);

      if ((await lstat(current)).isSymbolicLink()) {
        return false;
      }
    }
  } catch {
    return false;
  }

  return true;
}

function isPathInside(root: string, candidate: string) {
  return candidate.startsWith(`${root}${sep}`);
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
