// A local stand-in for a CDN sitting in front of the private bucket. It
// fetches the static manifest and objects from the origin with the CDN's own
// read secret. The client never reaches the origin directly. It caches
// every object it serves until the deploy pipeline invalidates it.
//
// A fingerprinted asset's name changes every time its bytes change, so its
// cache entry is correct forever and never needs invalidation. A page's
// object key never changes, so its cache entry goes stale the moment a new
// release republishes it. Only an explicit invalidation call clears it.
// This mirrors real CDN behavior: an origin's `cache-control` governs a
// browser's cache, not a CDN's edge cache, which a deploy pipeline manages
// directly.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { StaticOutputManifest } from "@demiurgejs/core/static";
import { objectUrl } from "./object-url";

const MANIFEST_KEY = ".demiurge/manifest.json";

export type CdnServerOptions = {
  adminSecret: string;
  bucketOrigin: string;
  bucketReadSecret: string;
  host?: string;
  port?: number;
};

type CacheEntry = {
  body: Buffer;
  headers: Record<string, string>;
  status: number;
};

export async function startCdnServer(options: CdnServerOptions) {
  const cache = new Map<string, CacheEntry>();
  let manifest: StaticOutputManifest | undefined;

  const server = createServer((request, response) => {
    handleRequest(request, response, options, cache, () => manifest, (next) => {
      manifest = next;
    }).catch((error) => {
      response.writeHead(502).end(String(error));
    });
  });

  await new Promise<void>((resolveListening, rejectListening) => {
    server.once("error", rejectListening);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => {
      server.removeListener("error", rejectListening);
      resolveListening();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("The CDN server did not bind to a network address.");
  }

  return {
    cachedKeys: () => [...cache.keys()],
    origin: `http://127.0.0.1:${address.port}`,
    stop: () => new Promise<void>((resolveStop) => server.close(() => resolveStop())),
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: CdnServerOptions,
  cache: Map<string, CacheEntry>,
  readManifest: () => StaticOutputManifest | undefined,
  setManifest: (manifest: StaticOutputManifest) => void,
) {
  const url = new URL(request.url ?? "/", "http://cdn.internal");

  if (url.pathname === "/_cdn/invalidate" && request.method === "POST") {
    if (request.headers["x-cdn-admin-secret"] !== options.adminSecret) {
      response.writeHead(403).end("Forbidden.");
      return;
    }

    // TYPE-EVIDENCE: this endpoint is only ever called by deploy.ts's invalidate(), which always sends { keys: string[] }.
    const body = JSON.parse((await readBody(request)).toString("utf8")) as { keys: string[] };
    for (const key of body.keys) {
      cache.delete(key);
    }
    if (body.keys.includes(MANIFEST_KEY)) {
      cache.delete(MANIFEST_KEY);
    }

    response.writeHead(204).end();
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405).end("Method not allowed.");
    return;
  }

  const manifest = readManifest() ?? await fetchManifest(options);
  setManifest(manifest);

  // A page or the 404 fallback is a manifest entry, and the response carries
  // the full header set the framework computed for it. Anything else, a
  // fingerprinted script, stylesheet, or font, is not a route at all. It
  // addresses the origin object directly by its own path. It carries only
  // the object's own stored metadata as headers, the same as a plain static
  // file host.
  const entry = manifest.entries.find((candidate) => candidate.pathname === url.pathname);
  const key = entry?.file ?? url.pathname.replace(/^\//, "");

  const cached = cache.get(key);
  if (cached) {
    respond(response, request.method, cached);
    return;
  }

  const object = entry ? await fetchObject(options, entry.file) : await fetchObject(options, key);
  if (object) {
    const resolved: CacheEntry = {
      body: object.body,
      headers: entry ? entry.headers : object.headers,
      status: entry?.status ?? 200,
    };
    cache.set(key, resolved);
    respond(response, request.method, resolved, "MISS");
    return;
  }

  const fallback = manifest.entries.find((candidate) => candidate.pathname === "*");
  if (!fallback) {
    response.writeHead(404, { "content-type": "text/plain" }).end("No fallback entry in the manifest.");
    return;
  }

  const cachedFallback = cache.get(fallback.file);
  if (cachedFallback) {
    respond(response, request.method, cachedFallback);
    return;
  }

  const fallbackObject = await fetchObject(options, fallback.file);
  if (!fallbackObject) {
    response.writeHead(502, { "content-type": "text/plain" })
      .end(`The origin has no object for ${JSON.stringify(fallback.file)}.`);
    return;
  }

  const resolvedFallback: CacheEntry = {
    body: fallbackObject.body,
    headers: fallback.headers,
    status: fallback.status,
  };
  cache.set(fallback.file, resolvedFallback);
  respond(response, request.method, resolvedFallback, "MISS");
}

function respond(
  response: ServerResponse,
  method: string | undefined,
  entry: CacheEntry,
  cacheState: "HIT" | "MISS" = "HIT",
) {
  response.writeHead(entry.status, { ...entry.headers, "x-cdn-cache": cacheState });
  response.end(method === "HEAD" ? undefined : entry.body);
}

async function fetchManifest(options: CdnServerOptions): Promise<StaticOutputManifest> {
  const object = await fetchObject(options, MANIFEST_KEY);
  if (!object) {
    throw new Error("The origin has not published a manifest yet.");
  }

  // TYPE-EVIDENCE: this key only ever holds JSON deploy.ts wrote from a StaticOutputManifest.
  return JSON.parse(object.body.toString("utf8")) as StaticOutputManifest;
}

async function fetchObject(options: CdnServerOptions, key: string) {
  const response = await fetch(objectUrl(options.bucketOrigin, key), {
    headers: { "x-bucket-secret": options.bucketReadSecret },
  });

  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`The origin returned ${response.status} for ${JSON.stringify(key)}.`);
  }

  const headers: Record<string, string> = {};
  const contentType = response.headers.get("content-type");
  const cacheControl = response.headers.get("cache-control");
  if (contentType) headers["content-type"] = contentType;
  if (cacheControl) headers["cache-control"] = cacheControl;

  return { body: Buffer.from(await response.arrayBuffer()), headers };
}

function readBody(request: IncomingMessage) {
  return new Promise<Buffer>((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolveBody(Buffer.concat(chunks)));
    request.on("error", rejectBody);
  });
}
