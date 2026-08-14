# Data and Caching

Demiurge keeps data timing explicit. Route `data` runs on the server, cache
scope is part of each request, and static paths are declared separately from
runtime data.

## Route data

Page routes may resolve data before rendering:

```tsx
import { page, tag } from "@demiurgejs/core";

export const GET = page({
  data: ({ cache, path }) =>
    cache.get({
      fn: () => loadPost(path.slug),
      key: ["post", path.slug],
      scope: "public",
      staleWhileRevalidate: "30s",
      tags: [tag("posts")],
      ttl: "5m",
    }),
  view: ({ data }) => <article>{data.title}</article>,
});
```

The framework passes the result to the page view. It also serializes the result
in the initial document. Browser navigation gets the result from the server.
The browser does not receive or run the data function.

## Cache scopes

Every cache request declares how broadly its result may be reused:

| Scope | Reuse boundary |
| --- | --- |
| `build` | Static-generation work for the build |
| `public` | Requests that may share one public value |
| `private` | Requests within an explicit private partition |
| `request` | Duplicate work during one request only |
| `none` | No cache reuse |

Private identity must be explicit. Do not place user-specific data in a public
entry or derive private identity from untrusted forwarded headers.

Keys use stable, injective serialization. Unsupported runtime values,
non-finite numbers, and negative zero are rejected rather than silently
colliding. `tag(...)` and `defineTags(...)` provide typed invalidation tags.

## Stores and lifetimes

`createMemoryCache(...)` is suitable for one process. To share public, private,
or build entries across requests and replicas, provide a `CacheStore` to
`createRequestHandler(...)` or construct a cache with `createCache(...)`.

Custom stores can run the conformance verifier exported from
`@demiurgejs/core/data/testing`. Store keys include the application, environment,
schema version, and scope so unrelated deployments do not collide.

TTL establishes the fresh lifetime. `staleWhileRevalidate` may serve a stale
entry while one lease owner refreshes it. Publication is owner-only and
invalidation cancels obsolete refresh work. Node graceful shutdown drains
tracked refresh work up to its configured deadline.

## Invalidation

`createInvalidation(...)` invalidates explicit keys or tags and reports stable
deletion counts. Invalidation is asynchronous because shared stores may require
network access.

```ts
const invalidation = createInvalidation(cache);

await invalidation.tags([tag("posts")]);
```

Cache invalidation does not implicitly refresh the browser router or regenerate
static HTML. Those are separate delivery actions.

## Reusable queries

`query(...)` packages a typed cache request for reuse by route data or other
server code:

```ts
const post = query({
  key: (slug: string) => ["post", slug],
  fn: (slug: string) => loadPost(slug),
  scope: "public",
  ttl: "5m",
});
```

Keep query functions server-only when they access secrets or private services.

## Idempotent mutations

`createMemoryIdempotencyStore(...)` and `runIdempotentMutation(...)` coordinate
duplicate mutations. `action(...)` can combine input parsing with an idempotency
policy. Completed results have a finite lifetime. In-flight mutations are not
expired or evicted while work is running.

The application must choose an idempotency key tied to the intended operation
and authenticated principal. A client-provided key alone is not an authorization
boundary.

## Static generation

Dynamic routes export `paths` to enumerate build-time URLs:

```tsx
export const paths = () => posts.map(({ slug }) => ({ slug }));
```

The static adapter validates and expands those values, renders page data at
build time, and writes an app-owned `404.html`. It also emits a deployment
manifest containing the response headers the host must apply.

The manifest has ordered `fileHeaderRules` for files without a route entry.
Each `pattern` is an ECMAScript regular expression for the file basename.

The first matching rule supplies the file headers. Content-hashed files use a
one-year immutable policy. Other files use a revalidating policy.

The host must apply each route entry before it applies the file rules. The
application controls caching for generated route entries through response
headers. The host controls validators, range requests, compression, and its
provider configuration.

Static generation fails on redirects, render errors, response cookies, unsafe
or colliding output paths, and security policy that depends on a request nonce.
