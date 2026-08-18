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
rules. It also serves the app-owned fallback with status 404.

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
