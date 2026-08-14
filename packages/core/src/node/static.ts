import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import {
  IMMUTABLE_FILE_CACHE_CONTROL,
  isContentHashedFileName,
  REVALIDATED_FILE_CACHE_CONTROL,
} from "../static-files";

export type StaticFileHandler = (request: Request) => Promise<Response | null>;

export type StaticFileHandlerOptions = {
  // Receives the file's path relative to `root`, always "/"-separated, so a
  // predicate can distinguish `index.html` from `docs/index.html`.
  exclude?: (path: string) => boolean;
  immutable?: (fileName: string) => boolean;
  prefix?: string;
  root: string;
};

// A null result keeps the handler composable. It means that the request does not
// identify an owned file. The route pipeline owns all other responses, including
// the 404 body and security headers. A traversal attempt gives the same result.
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

// Plain static requests must not access the framework build output. The output
// includes the SPA shell and the Node configuration manifest. The route pipeline
// serves the shell and applies the `@policy.ts` headers. The server never serves
// `demiurge-manifest.json` publicly. This exclusion applies only to the two root
// files. An application can serve a nested file such as `docs/index.html`.
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

    const etag = createWeakEtag(stats.size, stats.mtimeMs);
    const lastModified = stats.mtime.toUTCString();
    const headers = new Headers({
      "accept-ranges": "bytes",
      "cache-control": isImmutable(fileNameOf(filePath))
        ? IMMUTABLE_FILE_CACHE_CONTROL
        : REVALIDATED_FILE_CACHE_CONTROL,
      "content-length": String(stats.size),
      "content-type": contentTypeOf(filePath),
      "cross-origin-resource-policy": "same-origin",
      etag,
      "last-modified": lastModified,
      "x-content-type-options": "nosniff",
    });

    if (isNotModified(request, etag, stats.mtimeMs)) {
      await file.close();
      headers.delete("content-length");
      headers.delete("content-type");

      return new Response(null, { headers, status: 304 });
    }

    const range = canApplyRange(request, stats.mtimeMs)
      ? parseRange(request.headers.get("range"), stats.size)
      : null;

    if (range === "unsatisfiable") {
      await file.close();
      headers.delete("content-length");
      headers.delete("content-type");
      headers.set("content-range", `bytes */${stats.size}`);

      return new Response(null, { headers, status: 416 });
    }

    if (range) {
      const contentLength = range.end - range.start + 1;
      headers.set("content-length", String(contentLength));
      headers.set("content-range", `bytes ${range.start}-${range.end}/${stats.size}`);

      if (request.method === "HEAD") {
        await file.close();
        return new Response(null, { headers, status: 206 });
      }

      return new Response(
        Readable.toWeb(
          file.createReadStream({ end: range.end, start: range.start }),
        ) as ReadableStream,
        { headers, status: 206 },
      );
    }

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

function createWeakEtag(size: number, mtimeMs: number) {
  return `W/"${size.toString(16)}-${Math.trunc(mtimeMs).toString(16)}"`;
}

function isNotModified(request: Request, etag: string, mtimeMs: number) {
  const ifNoneMatch = request.headers.get("if-none-match");

  // If-None-Match takes precedence over If-Modified-Since. Weak comparison is
  // correct for GET/HEAD cache validation, so W/ is removed from both sides.
  if (ifNoneMatch !== null) {
    return ifNoneMatch.trim() === "*" || ifNoneMatch.split(",").some(
      (candidate) => weakEtagValue(candidate) === weakEtagValue(etag),
    );
  }

  const ifModifiedSince = request.headers.get("if-modified-since");

  if (ifModifiedSince === null) {
    return false;
  }

  const since = Date.parse(ifModifiedSince);

  // HTTP dates have one-second precision. Compare the file timestamp at the
  // same precision rather than making a freshly-written file look newer.
  return Number.isFinite(since) && Math.floor(mtimeMs / 1000) * 1000 <= since;
}

function weakEtagValue(value: string) {
  return value.trim().replace(/^W\//i, "");
}

type ByteRange = { end: number; start: number };

function parseRange(
  header: string | null,
  size: number,
): ByteRange | "unsatisfiable" | null {
  if (header === null) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());

  // A server that does not support the requested unit, syntax, or multiple
  // ranges ignores Range and returns the complete representation. A 416 is
  // reserved for a valid byte-range set that cannot select this resource.
  if (!match || (!match[1] && !match[2])) {
    return null;
  }

  if (size === 0) {
    return "unsatisfiable";
  }

  if (!match[1]) {
    const suffixLength = Number(match[2]);

    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }

    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd)) {
    return null;
  }

  if (start >= size) {
    return "unsatisfiable";
  }

  if (match[2] && requestedEnd < start) {
    return null;
  }

  return { start, end: Math.min(requestedEnd, size - 1) };
}

function canApplyRange(request: Request, mtimeMs: number) {
  const ifRange = request.headers.get("if-range");

  if (ifRange === null) {
    return true;
  }

  // If-Range requires strong comparison for an entity-tag. This handler's
  // stat-derived validator is intentionally weak, so only an HTTP date can
  // authorize a partial response.
  if (ifRange.trim().startsWith('"') || /^W\//i.test(ifRange.trim())) {
    return false;
  }

  const date = Date.parse(ifRange);
  return Number.isFinite(date) && Math.floor(mtimeMs / 1000) * 1000 <= date;
}

function resolveFilePath(root: string, prefix: string, pathname: string) {
  let decoded: string;

  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  // A null byte truncates the path for some system calls. A name such as
  // "app.js\0.txt" could read a file that differs from the checked file.
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
  return isContentHashedFileName(fileName);
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
