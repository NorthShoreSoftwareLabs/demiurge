import {
  contentTypeForExtension,
  IMMUTABLE_FILE_CACHE_CONTROL,
  isContentHashedFileName,
  REVALIDATED_FILE_CACHE_CONTROL,
} from "../static-files";

// An edge isolate has no persistent filesystem at request time, so the Node
// root-directory boundary does not exist here. The boundary is the map
// itself. A request can only reach a pathname the map declares, which makes
// traversal, symbolic links, and null bytes unreachable rather than rejected.
export type EdgeAsset = {
  body: ArrayBuffer | ArrayBufferView | string;
  contentType?: string;
  immutable?: boolean;
};

export type EdgeAssetMap = Readonly<Record<string, EdgeAsset>>;

export type EdgeAssetHandler = (request: Request) => Promise<Response | null>;

export type EdgeAssetHandlerOptions = {
  assets: EdgeAssetMap;
  immutable?: (fileName: string) => boolean;
  prefix?: string;
};

type ResolvedAsset = {
  body: Uint8Array<ArrayBuffer>;
  cacheControl: string;
  contentType: string;
  etag: string;
};

// The framework build output is never a public asset. The route pipeline owns
// the shell document and applies the policy headers, and the manifest
// describes the deployment rather than serving it.
const excludedPathnames = new Set([
  "/demiurge-manifest.json",
  "/index.html",
]);

export function createEdgeAssetHandler(
  options: EdgeAssetHandlerOptions,
): EdgeAssetHandler {
  const isImmutable = options.immutable ?? isContentHashedFileName;
  const prefix = normalizePrefix(options.prefix);
  const assets = new Map<string, ResolvedAsset>();

  for (const [pathname, asset] of Object.entries(options.assets)) {
    const normalized = normalizePathname(pathname);

    if (excludedPathnames.has(normalized)) {
      continue;
    }

    const body = toBytes(asset.body);
    assets.set(normalized, {
      body,
      cacheControl: (asset.immutable ?? isImmutable(fileNameOf(normalized)))
        ? IMMUTABLE_FILE_CACHE_CONTROL
        : REVALIDATED_FILE_CACHE_CONTROL,
      contentType: asset.contentType ?? contentTypeOf(normalized),
      etag: createEtag(body),
    });
  }

  return async function handleEdgeAsset(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return null;
    }

    const pathname = resolvePathname(prefix, new URL(request.url).pathname);
    const asset = pathname === null ? undefined : assets.get(pathname);

    if (!asset) {
      return null;
    }

    const headers = new Headers({
      "cache-control": asset.cacheControl,
      "content-length": String(asset.body.byteLength),
      "content-type": asset.contentType,
      "cross-origin-resource-policy": "same-origin",
      etag: asset.etag,
      "x-content-type-options": "nosniff",
    });

    if (isNotModified(request, asset.etag)) {
      headers.delete("content-length");
      headers.delete("content-type");

      return new Response(null, { headers, status: 304 });
    }

    if (request.method === "HEAD") {
      return new Response(null, { headers });
    }

    return new Response(asset.body, { headers });
  };
}

// A bundled asset has no modification time, so the validator comes from the
// bytes. FNV-1a over the body with the byte length keeps the value stable
// across isolates and across deployments of the same build.
function createEtag(body: Uint8Array) {
  let hash = 0x811c9dc5;

  for (const byte of body) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }

  return `W/"${body.byteLength.toString(16)}-${hash.toString(16)}"`;
}

function isNotModified(request: Request, etag: string) {
  const ifNoneMatch = request.headers.get("if-none-match");

  if (ifNoneMatch === null) {
    return false;
  }

  return ifNoneMatch.trim() === "*" || ifNoneMatch.split(",").some(
    (candidate) => weakEtagValue(candidate) === weakEtagValue(etag),
  );
}

function weakEtagValue(value: string) {
  return value.trim().replace(/^W\//i, "");
}

function resolvePathname(prefix: string, pathname: string) {
  let decoded: string;

  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (prefix) {
    if (!decoded.startsWith(prefix)) {
      return null;
    }

    decoded = decoded.slice(prefix.length - 1);
  }

  return normalizePathname(decoded);
}

function normalizePathname(pathname: string) {
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function normalizePrefix(prefix: string | undefined) {
  if (!prefix || prefix === "/") {
    return "";
  }

  return `/${prefix.replace(/^\/|\/$/g, "")}/`;
}

// The handler owns its copy of every body. A caller that reuses the buffer it
// passed in cannot change what a later request receives.
function toBytes(body: EdgeAsset["body"]): Uint8Array<ArrayBuffer> {
  if (typeof body === "string") {
    return new TextEncoder().encode(body);
  }

  const view = ArrayBuffer.isView(body)
    ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
    : new Uint8Array(body);
  const bytes = new Uint8Array(view.byteLength);
  bytes.set(view);

  return bytes;
}

function fileNameOf(pathname: string) {
  return pathname.slice(pathname.lastIndexOf("/") + 1);
}

function contentTypeOf(pathname: string) {
  const fileName = fileNameOf(pathname);
  const dot = fileName.lastIndexOf(".");
  const extension = dot === -1 ? "" : fileName.slice(dot);

  return contentTypeForExtension(extension);
}
