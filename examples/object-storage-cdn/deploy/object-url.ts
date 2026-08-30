// Both the CDN and the deploy pipeline address a bucket object by the same
// URL shape. A key such as `about/index.html` carries a literal slash. It
// is percent-encoded as one path segment rather than split into two. This
// keeps the bucket server's routing free of any ambiguity between a key's
// own slashes and the URL's path separators.
export function objectUrl(bucketOrigin: string, key: string) {
  return `${bucketOrigin}/objects/${encodeURIComponent(key)}`;
}
