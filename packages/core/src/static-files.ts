export const CONTENT_HASHED_FILE_NAME_PATTERN =
  /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

export const IMMUTABLE_FILE_CACHE_CONTROL =
  "public, max-age=31536000, immutable";

export const REVALIDATED_FILE_CACHE_CONTROL =
  "public, max-age=0, must-revalidate";

export function isContentHashedFileName(fileName: string) {
  return CONTENT_HASHED_FILE_NAME_PATTERN.test(fileName);
}
