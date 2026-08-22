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

## Negative results

A `fn` may call `cacheNotFound(message?)` instead of returning a value, to
report that the requested item does not currently exist. `cache.get(...)`
caches that outcome the same way it caches a real result, and re-throws a
`CacheNotFoundError` on every hit until the entry expires:

```tsx
cache.get({
  fn: async () => {
    const post = await db.posts.findBySlug(path.slug);
    if (!post) return cacheNotFound(`no post at ${path.slug}`);
    return post;
  },
  key: ["post", path.slug],
  notFoundTtl: "30s",
  ttl: "5m",
});
```

This avoids repeating the full lookup for every request against a slug that
does not resolve. `notFoundTtl` sets the negative entry's lifetime separately
from `ttl`, because a missing item tends to start existing sooner than an
existing item tends to disappear. It falls back to `ttl` when omitted. A
request with neither field caches a negative result forever, the same as a
positive one, until an explicit `invalidateTags(...)` call.

Catch `CacheNotFoundError` with `isCacheNotFoundError(...)` where a negative
result needs a different treatment. One example is translating it into an
HTTP response with `httpError(404, ...)` at the route layer. The cache layer
stays independent of HTTP status codes. That translation is the caller's job.

A negative result reached through `staleWhileRevalidate` replaces the stale
entry immediately instead of waiting out its remaining freshness.
`cacheNotFound()` is the application asserting that the item is gone, not a
transient failure. An ordinary thrown error during a background refresh does
not replace the stale entry. It reaches `onBackgroundError`, and the existing
value keeps serving.

## Redis store

`createRedisCacheStore(...)` from `@demiurgejs/core/redis` shares `public`,
`private`, and `build` entries across every process talking to the same
Redis database. This is the gap the memory store leaves open. A memory store
keeps its entries in one process. A second instance, or a redeploy, starts
from an empty cache and never sees the first instance's tag invalidations.

Pass an [ioredis](https://github.com/redis/ioredis) client the application
already constructed and connected:

```ts
import { createRedisCacheStore } from "@demiurgejs/core/redis";
import { Redis } from "ioredis";

const store = createRedisCacheStore({ client: new Redis(process.env.REDIS_URL) });
```

The store owns none of the client's connection lifecycle. TLS, Sentinel,
retry policy, and shutdown stay the application's decision, the same way an
edge deployment's shared stores stay explicit rather than framework-managed.

`ioredis` is an optional peer dependency. Only an application that constructs
a Redis store installs it, the same rule ADR 0006 states for a host adapter
dependency.

Tag invalidation runs as one atomic Lua script per write. A tag deleted by one
process is invisible to every other process reading the same database
immediately after. `keyPrefix` scopes one store's entry, tag, and lease keys
away from other Redis use in the same database. Two Demiurge deployments that
share a database need distinct prefixes.

The Redis store passes both conformance contracts from
`@demiurgejs/core/data/testing`. It behaves identically to the memory store
from the framework's point of view. `staleWhileRevalidate` coordination works
the same way, backed by Redis key expiration instead of an in-process Map.

## KV store

`createKvCacheStore(...)` from `@demiurgejs/core/kv` shares `public`,
`private`, and `build` entries across an edge deployment where Redis is
usually not reachable. This is the store the edge adapter's `cacheStore`
option is for. Most edge runtimes offer a key-value store instead of a Redis
connection, so this store targets that shape rather than a specific vendor.

The store is written against `EdgeKvNamespace`, a small interface this
framework defines and documents in `@demiurgejs/core/kv`. It is modeled on
the binding API Cloudflare Workers KV exposes, because that shape is the one
most other edge KV providers already copy. This is an adapter for that
documented shape, not a dependency on any vendor SDK. Pass a connected
client the application already constructed and bound:

```ts
import { createKvCacheStore } from "@demiurgejs/core/kv";

const store = createKvCacheStore({ namespace: env.CACHE_KV });
```

A Deno KV or Vercel Edge Config client needs a small wrapper first if it
does not already match this shape.

### Consistency caveat

A KV store gives up two things Redis's Lua scripts provide: cross-key
atomicity and a compare-and-swap primitive. `set()`, `delete()`, and
`publishRefresh()` each run as several sequential operations rather than one
atomic script. A reader racing with one of these calls can briefly see a
partially updated entry.

Tag invalidation stores tag membership as key-prefixed entries and uses
`list()` plus bulk delete to invalidate a tag, the usual KV pattern for this.
`list()` on a real KV store is typically eventually consistent. A membership
entry written just before a matching `invalidateTags()` call may not appear
on that call yet.

`acquireRefreshLease()` and `publishRefresh()` implement single-writer
coordination with a get-then-write pattern, not a real compare-and-swap. Two
isolates racing to acquire the same lease can both succeed. The worst case is
redundant refresh work, the same failure mode `staleWhileRevalidate` already
tolerates when no coordination exists at all. Do not rely on this store for
exclusive-execution correctness beyond that. Prefer the Redis store where a
stronger guarantee matters.

The KV store passes both conformance contracts from
`@demiurgejs/core/data/testing`, verified against a minimal in-memory fake of
`EdgeKvNamespace` used only in the framework's own tests.

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

Run the framework build command for a static application:

```sh
demiurge build
```

Set `SITE_ORIGIN` when route data or document metadata requires the production
origin. You can also use `--origin` for the same value.

Run the policy-aware preview after the build:

```sh
demiurge preview
```

The preview applies route headers and file header rules from the output
manifest. It does not reproduce provider TLS, compression, or range support.

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

Every file rule also carries the security headers of the root document policy.
The Content Security Policy is excluded because the framework cannot compute
content hashes for a file it did not render. Trusted Types is excluded with it
because a browser reads Trusted Types from the Content Security Policy header
only.

An application declares extra rules for its own file patterns:

```ts
demiurge({
  static: {
    headers: [
      {
        headers: { crossOriginResourcePolicy: "cross-origin" },
        pattern: "\\.woff2$",
      },
    ],
  },
});
```

Each declared rule merges over the baseline set and is matched before the
framework rules.

The host must apply each route entry before it applies the file rules. The
application controls caching for generated route entries through response
headers. The host controls validators, range requests, compression, and its
provider configuration.

Static generation fails on redirects, render errors, response cookies, unsafe
or colliding output paths, and security policy that depends on a request nonce.

## Vercel static output

Select the Vercel static adapter in the Vite configuration:

```ts
import { vercelStatic } from "@demiurgejs/core/static";
import { demiurge } from "@demiurgejs/core/vite";

demiurge({
  static: {
    deployment: vercelStatic(),
  },
});
```

The build writes [Build Output API version 3](https://vercel.com/docs/build-output-api)
to `.vercel/output`. It copies the public site to `.vercel/output/static`.

The generated `config.json` applies route security headers before file cache
rules. The final fallback rewrite includes its security headers and status 404.

Set the Vercel [Framework Preset](https://vercel.com/docs/builds/configure-a-build#framework-preset)
to `Other`. Do not set an Output Directory override.

An application can override the framework cache defaults with typed Vercel
cache rules:

```ts
vercelStatic({
  cache: [
    {
      source: "/videos/:path*",
      value: "public, max-age=604800",
    },
  ],
});
```

Vercel applies every matching route in order. A later route replaces an earlier
header of the same name. The generated output therefore repeats each
application rule after the framework file rules. An application rule keeps the
last word for a served file.

Vercel reads a root `vercel.json` before the build starts. Keep project settings
there only when the application needs settings that Build Output API does not
represent.

### Access-Control-Allow-Origin

Vercel adds `access-control-allow-origin: *` to every static response on its
own. The generated `config.json` states an explicit value instead, so this
platform default never reaches a deployment undeclared.

Without a declared CORS policy, the value matches the build origin, the same
origin the CLI reads from `--origin` or `SITE_ORIGIN`:

```ts
vercelStatic({
  cors: { origins: ["https://app.example.com"] },
});
```

A static response cannot vary this header by request, so a declared policy
must resolve to a single origin or the wildcard origin `"*"`. Declare
`cors.origins` as the wildcard string or as an array with exactly one origin.
