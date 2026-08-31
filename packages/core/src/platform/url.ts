/**
 * Drops the query string and the fragment from a URL or path, leaving the
 * path portion. Both are cut at the first occurrence, so a `?` inside a
 * fragment and a `#` inside a query are handled the way a browser handles
 * them: the earlier delimiter wins.
 */
export function urlPath(url: string) {
  return url.split("?")[0]!.split("#")[0]!;
}

/**
 * Resolves the file extension of a URL or path, lower-cased and without the
 * leading dot. The query string and the fragment are ignored, and only the
 * last path segment is considered, so a dot in a directory name never leaks
 * into the answer.
 *
 * A name with no dot and a name ending in a dot both answer the empty
 * string, which no caller's extension table names, so an unparseable name is
 * reported as unknown rather than mistaken for a format.
 */
export function urlExtension(url: string) {
  const name = urlPath(url).split("/").at(-1) ?? "";

  return name.includes(".") ? name.split(".").at(-1)!.toLowerCase() : "";
}
