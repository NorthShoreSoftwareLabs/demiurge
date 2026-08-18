import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import {
  negotiateImageFormat,
  transformImage,
  type EncodedImage,
} from "../platform/image-codec";
import { defaultImageOptimizerPath } from "../platform/image-url";
import type { ImageVariantDescriptor } from "../platform/image-url";
import {
  isAllowedImageSource,
  parseImageOptimizerRequest,
} from "../platform/images";
import type { ImagePolicy } from "../platform/images";
import type { StaticFileHandler } from "./static";
import { REVALIDATED_FILE_CACHE_CONTROL } from "../static-files";

export type ImageOptimizerFetch = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<Response>;

export type ImageOptimizerOptions = {
  // The number of encoded variants that stay in memory. The optimizer keeps
  // the most recent request at the front.
  cacheSize?: number;
  fetch?: ImageOptimizerFetch;
  policy?: ImagePolicy;
  // Maps a static loader variant path back to the transform behind it. The
  // development server passes the recorded plans, so a page renders the same
  // URL in development and in the static build.
  resolveVariant?: (pathname: string) => ImageVariantDescriptor | undefined;
  // The directory that holds every local source image, normally the client
  // build output.
  root: string;
};

const defaultCacheSize = 64;
const maximumRemoteImageBytes = 20 * 1024 * 1024;

// The optimizer answers the same URL that `planImageTransform` writes. It
// returns null for every other path, so it composes with the static file
// handler and the route pipeline.
export function createImageOptimizer(
  options: ImageOptimizerOptions,
): StaticFileHandler {
  const root = resolve(options.root);
  const policy = options.policy ?? {};
  const optimizerPath = policy.optimizerPath ?? defaultImageOptimizerPath;
  const cacheSize = options.cacheSize ?? defaultCacheSize;
  const load = options.fetch ?? ((input, init) => fetch(input, init));
  const cache = new Map<string, EncodedImage>();

  return async function handleImageRequest(request) {
    const url = new URL(request.url);
    const variant = url.pathname === optimizerPath
      ? undefined
      : options.resolveVariant?.(url.pathname);

    if (url.pathname !== optimizerPath && !variant) {
      return null;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return plainText(405, "Method Not Allowed", {
        allow: "GET, HEAD",
      });
    }

    if (variant && !isAllowedImageSource(variant.src, policy)) {
      return plainText(403, "The image policy does not allow this image source.");
    }

    const parsed = variant
      ? ({ descriptor: variant, ok: true } as const)
      : parseImageOptimizerRequest(url, policy);

    if (!parsed.ok) {
      return plainText(parsed.rejection.status, parsed.rejection.reason);
    }

    const format = negotiateImageFormat(
      parsed.descriptor,
      variant ? null : request.headers.get("accept"),
    );
    const key = `${format}|${url.pathname}${url.search}`;
    let encoded = cache.get(key);

    if (encoded) {
      cache.delete(key);
    } else {
      const source = await readSource(parsed.descriptor);

      if (!source) {
        return plainText(404, "The image source does not exist.");
      }

      encoded = await transformImage(source, {
        format,
        quality: parsed.descriptor.quality,
        width: parsed.descriptor.width,
      });
    }

    cache.set(key, encoded);

    while (cache.size > cacheSize) {
      cache.delete(cache.keys().next().value as string);
    }

    return respond(
      request,
      encoded,
      !variant && parsed.descriptor.format === "auto",
    );
  };

  async function readSource(descriptor: ImageVariantDescriptor) {
    if (descriptor.sourceKind === "remote") {
      const response = await load(descriptor.src);

      if (!response.ok) {
        return undefined;
      }

      const body = new Uint8Array(await response.arrayBuffer());

      return body.byteLength > maximumRemoteImageBytes ? undefined : body;
    }

    const file = resolveLocalFile(root, descriptor.src);

    if (!file) {
      return undefined;
    }

    try {
      return new Uint8Array(await readFile(file));
    } catch {
      return undefined;
    }
  }
}

// The URL carries the source path rather than a content hash, so a long
// immutable lifetime would outlive a replaced source file. A strong entity
// tag keeps the revalidation cheap instead.
function respond(request: Request, encoded: EncodedImage, varyOnAccept: boolean) {
  const etag = `"${weakHash(encoded.body)}"`;
  const headers = new Headers({
    "cache-control": REVALIDATED_FILE_CACHE_CONTROL,
    "content-type": encoded.contentType,
    etag,
  });

  if (varyOnAccept) {
    headers.set("vary", "accept");
  }

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { headers, status: 304 });
  }

  headers.set("content-length", String(encoded.body.byteLength));

  return new Response(
    request.method === "HEAD" ? null : (encoded.body as unknown as BodyInit),
    { headers, status: 200 },
  );
}

function plainText(
  status: number,
  body: string,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", ...extraHeaders },
    status,
  });
}

function resolveLocalFile(root: string, src: string) {
  let decoded: string;

  try {
    decoded = decodeURIComponent(src.split("?")[0]!.split("#")[0]!);
  } catch {
    return undefined;
  }

  if (decoded.split(/[\\/]/).includes("..")) {
    return undefined;
  }

  const file = resolve(root, `.${decoded}`);

  return relative(root, file).split(sep).includes("..") ? undefined : file;
}

function weakHash(body: Uint8Array) {
  let low = 0x811c9dc5;
  let high = 0x01000193;

  for (const byte of body) {
    low = Math.imul(low ^ byte, 0x01000193) >>> 0;
    high = Math.imul(high ^ byte, 0x85ebca6b) >>> 0;
  }

  return `${low.toString(36)}${high.toString(36)}${body.byteLength.toString(36)}`;
}
