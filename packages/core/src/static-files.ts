export const CONTENT_HASHED_FILE_NAME_PATTERN =
  /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

export const IMMUTABLE_FILE_CACHE_CONTROL =
  "public, max-age=31536000, immutable";

export const REVALIDATED_FILE_CACHE_CONTROL =
  "public, max-age=0, must-revalidate";

export function isContentHashedFileName(fileName: string) {
  return CONTENT_HASHED_FILE_NAME_PATTERN.test(fileName);
}

export const DEFAULT_CONTENT_TYPE = "application/octet-stream";

const CONTENT_TYPES_BY_EXTENSION: Record<string, string> = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".eot": "application/vnd.ms-fontobject",
  ".gif": "image/gif",
  ".gz": "application/gzip",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".ogv": "video/ogg",
  ".otf": "font/otf",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
  ".wasm": "application/wasm",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

/**
 * Resolves the content type for a file extension, with or without the leading
 * dot and in any letter case.
 *
 * The table covers the common web asset extensions and is not exhaustive by
 * design. `application/octet-stream` is the correct answer for anything the
 * table does not name, so an unlisted extension is a safe result rather than a
 * defect. Responses that carry this value are served with `nosniff`, which
 * keeps an unknown body from being interpreted as an executable type.
 */
export function contentTypeForExtension(extension: string): string {
  const normalized = extension.toLowerCase();

  return (
    CONTENT_TYPES_BY_EXTENSION[
      normalized.startsWith(".") ? normalized : `.${normalized}`
    ] ?? DEFAULT_CONTENT_TYPE
  );
}
