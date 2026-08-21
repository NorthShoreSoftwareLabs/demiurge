import { createHash } from "node:crypto";
import {
  resolveFontAssets,
  type FontAsset,
  type FontAssetOptions,
} from "../platform/font-assets";
import { defaultFontPath } from "../platform/fonts";
import { REVALIDATED_FILE_CACHE_CONTROL } from "../static-files";
import type { StaticFileHandler } from "./static";

export type FontAssetHandlerOptions = FontAssetOptions;

// The handler answers the self-hosted font URLs that the document declares.
// It returns null for every other path, so it composes with the static file
// handler and the route pipeline. The image optimizer composes the same way.
export function createFontAssetHandler(
  options: FontAssetHandlerOptions,
): StaticFileHandler {
  const basePath = options.basePath ?? defaultFontPath;
  let pending: Promise<Map<string, FontAsset>> | undefined;

  return async function handleFontRequest(request) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith(`${basePath}/`)) {
      return null;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        headers: {
          allow: "GET, HEAD",
          "content-type": "text/plain; charset=utf-8",
        },
        status: 405,
      });
    }

    pending ??= loadAssets();

    let assets: Map<string, FontAsset>;

    try {
      assets = await pending;
    } catch (error) {
      pending = undefined;
      throw error;
    }

    const asset = assets.get(url.pathname);

    return asset ? respond(request, asset) : null;
  };

  async function loadAssets() {
    const assets = await resolveFontAssets({ ...options, basePath });

    return new Map(assets.map((asset) => [asset.url, asset]));
  }
}

// A font URL names the family, the weight, and the style rather than the
// content of the file. A strong entity tag keeps a replaced file cheap to
// revalidate, the same trade the image optimizer makes.
function respond(request: Request, asset: FontAsset) {
  const etag = `"${createHash("sha256").update(asset.body).digest("base64url").slice(0, 27)}"`;
  const headers = new Headers({
    "cache-control": REVALIDATED_FILE_CACHE_CONTROL,
    "content-type": asset.contentType,
    etag,
  });

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { headers, status: 304 });
  }

  headers.set("content-length", String(asset.body.byteLength));

  // SAFETY: the font body is an ArrayBuffer-backed view that the DOM body type accepts.
  return new Response(
    request.method === "HEAD" ? null : (asset.body as Uint8Array<ArrayBuffer>),
    { headers, status: 200 },
  );
}
