import { CONTENT_HASHED_FILE_NAME_PATTERN } from "../static-files";

export function translateFileHeaderPattern(pattern: string) {
  if (pattern === ".*") {
    return "^/.*$";
  }
  if (pattern === CONTENT_HASHED_FILE_NAME_PATTERN.source) {
    return "^/(?:.*/)?[^/]*-[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9]+$";
  }

  return `^/${translateFileNamePattern(pattern)}$`;
}

// Demiurge tests a static file header pattern against the file basename with
// an unanchored `RegExp.test(...)`. The pattern can match anywhere in the
// name. Vercel matches `src` against the complete pathname, which always
// carries a directory prefix. This rebuilds the basename test as a pathname
// pattern. A leading `^` pins the match to the start of the basename. A
// trailing `$` pins it to the end. Without an anchor, the match can begin or
// end anywhere in the basename.
function translateFileNamePattern(pattern: string) {
  const startsAtBasename = pattern.startsWith("^");
  const endsAtBasename = pattern.endsWith("$") && !pattern.endsWith("\\$");
  const body = pattern.slice(
    startsAtBasename ? 1 : 0,
    endsAtBasename ? -1 : undefined,
  );
  const prefix = startsAtBasename ? "(?:.*/)?" : "(?:.*/)?[^/]*";
  const suffix = endsAtBasename ? "" : "[^/]*";

  return `${prefix}(?:${body})${suffix}`;
}
