# Data And Static Generation

## Data Primitives

Demiurge should avoid making data loading feel separate from route handling.
A page `GET` is still a `GET`; data is part of producing that response.

Recommended page shape:

```ts
export const GET = page({
  render: { mode: "ssr" },

  data: async ({ path, cache }) => ({
    post: await cache.get(postBySlug(path.slug)),
  }),

  view: ({ data }) => <PostPage post={data.post} />,
});
```

`data` is optional. React Server Components may fetch data inside the component
tree instead:

```tsx
async function PostPage({ slug }: { slug: string }) {
  const post = await cache.get(postBySlug(slug));
  return <Post post={post} />;
}
```

Both route-level and component-level data should use the same request-aware
framework primitives so caching, dedupe, cancellation, tracing, and invalidation
work consistently.

The first route-level slice supports `page({ data, view })` during route
loading. `data` receives the matched request context, including `path`,
`pathname`, `request`, `search`, `url`, and a request-scoped framework `cache`.
Loaded route matches carry the resolved `data` value for the page renderer.
Buffered SSR, streaming SSR, static generation, and hydration all consume this
resolved value. Route-level `data` finishes before rendering begins; streaming
inside the component tree uses React Suspense boundaries.

## Query Objects

Reusable data should be represented as typed query objects:

```ts
export const postBySlug = query({
  key: (slug: string) => ["post", slug],
  tags: (slug) => [tags.posts(), tags.post({ slug })],
  ttl: "10m",
  scope: "public",
  fn: async (slug) => db.posts.findBySlug(slug),
});
```

Then it can be used from route data, metadata, layouts, route handlers, and
server components:

```ts
const post = await cache.get(postBySlug(path.slug));
```

The data API exposes `query(...)`, `createMemoryCache(...)`, `tag(...)`, and
`defineTags(...)`. Query objects produce typed cache requests with stable keys,
tags, TTLs, and scopes. The memory cache supports request dedupe, shared
build/public/private entries, `none` bypass, TTL expiry, and key/tag
invalidation.

## Render Timing And Data Timing

Default rule:

> Page data runs in the same phase as the page render unless explicitly declared
> otherwise.

| Render mode | Default data timing | Notes |
| --- | --- | --- |
| `static` | build time | One run per generated path. |
| `ssr` | request time | Can use request, cookies, headers, and runtime cache. |
| `rsc` | server render request time | Component-level server data is common. |
| `spa` | client or explicit server call | Server data must come through API/server functions or prerendered payloads. |

## Cache API

Cache use should be explicit:

```ts
const post = await cache.get({
  key: ["post", slug],
  tags: [tags.posts(), tags.post({ slug })],
  scope: "public",
  ttl: "5m",
  staleWhileRevalidate: "1h",
  fn: () => cms.post(slug),
});
```

Cache scopes:

```ts
type CacheScope =
  | "build"
  | "public"
  | "private"
  | "request"
  | "none";
```

- `build`: build-process cache for static generation.
- `public`: shared across users; must not depend on cookies/session/auth.
- `private`: user-specific.
- `request`: dedupe only inside the current request/render.
- `none`: always run the source function.

The framework should detect dangerous combinations, such as reading cookies or
session data and then writing a `public` cache entry.

`build`, `public`, and `private` use separate backend key spaces. A private
query key must include the user/tenant identity it is private to; the framework
does not guess identity from cookies. `request` remains in the request's cache
facade and never reaches a shared backend. `none` bypasses both.

### Current Cache Limitations

The implemented cache stores data-query results. It does not cache rendered
React output or complete HTTP responses. In particular:

- Stale-while-revalidate is implemented for shared data-query results. It does
  not yet regenerate rendered React output or complete HTTP responses.
- Omitting `ttl` currently gives a shared `build`, `public`, or `private` entry
  an infinite lifetime. Shared caching should therefore always declare a TTL
  and use tags for event-driven invalidation. A future API should require an
  explicit `forever` choice instead of treating omission as that choice.
- The built-in memory store is process-local. Sharing values between processes
  requires a conforming shared store; provider-specific Redis and KV adapters
  have not shipped yet.
- Cache tags invalidate the framework data cache only. They do not purge a CDN,
  a browser cache, a prerendered document, or a client-router cache.

These are implementation limits, not a rule that only data may ever be cached.
Rendered output and HTTP responses require different keys, security checks, and
invalidation mechanisms and should be added as distinct cache layers.

## Cache Layers

Every rendering mode may use caching, but the reusable representation differs
by layer. A cache policy must say both what is cached and where it may be
reused; `render.mode` alone implies no cross-request caching.

| Layer | Reusable unit | Key source | Lifetime and invalidation | Principal limits |
| --- | --- | --- | --- | --- |
| Request | Promise or query result | Explicit query key | One request/render | Dedupe only; never reaches a shared store. |
| Origin/shared store | Data result or, in a future renderer cache, a nonce-free render artifact | Required application namespace, scope, and explicit domain key | TTL plus framework tags | Private identity must be explicit. A complete nonce-bearing document is not a reusable artifact. |
| CDN/shared HTTP cache | Complete HTTP response | Request method and target URI, refined by `Vary` and provider configuration | `s-maxage`, shared-cache stale directives, validators, and provider purge/tags | Public representations only by default. Cookie-, session-, or authorization-dependent output must bypass shared caching unless its partition is explicit and supported. |
| Browser/private HTTP cache | Complete HTTP response | Request method and target URI, refined by `Vary` | `max-age`, validators, and normal browser eviction | May store `private` responses, but sensitive responses and nonce-backed documents require stricter handling. Framework cache tags cannot invalidate an already stored browser response. |

HTTP caches construct keys from the request target and `Vary`; they do not know
the framework's query keys. Search parameters are already part of the target
URI. A response that depends on a request header must emit the corresponding
`Vary` field. Varying on an entire `Cookie` header is usually both unsafe and
destructive to cache efficiency, so personalized shared caching should instead
use an explicit tenant/user partition at an origin cache or bypass the CDN.

An eventual render cache should default its origin key to the deployment/build
identity, route identity, concrete pathname, and normalized search parameters.
Additional header inputs must be declared. A private entry must also include an
explicit user or tenant identity. Reading an undeclared request-dependent input
must make a public entry fail closed or bypass caching rather than silently
reuse the wrong representation.

### Rendering Modes At Each Layer

- `static`: the complete document may be stored at the origin, CDN, and browser
  when its CSP and response data are themselves reusable. Fingerprinted assets
  can use long-lived immutable caching; HTML normally needs revalidation or a
  bounded freshness policy.
- `ssr`: data queries may be cached while React and the security wrapper run on
  every request. A future origin render cache may store a nonce-free body and
  bootstrap-data artifact, then create a fresh document wrapper. A complete
  nonce-backed response cannot be replayed as the cached representation.
- `streaming`: query caching works normally. A live stream is one-shot; an
  output cache can store it only after successfully materializing a complete
  representation. A cache hit may be delivered immediately and does not
  preserve the original boundary timing. CDN support for storing streamed
  responses is platform-specific and must be an adapter capability.
- `prerender`: the build prelude and postponed state are immutable artifacts for
  that deployment, not TTL entries. Request-time holes may use the normal data
  cache. The final nonce-backed document is still composed per request.
- RSC: separately fetched public Flight responses may use ordinary origin and
  HTTP caching with a key that includes the route/tree and build identity.
  Personalized Flight responses must remain private or use an explicit origin
  partition. Flight embedded into the initial document inherits that
  document's cache restrictions.

CDN and browser caching are HTTP behavior, expressed with `Cache-Control`,
validators, and `Vary`; Redis-style caching is application behavior. They may
share high-level TTL or tag intent, but a framework tag cannot pretend to purge
all three layers. CDN tag purge is provider-specific, and browser entries can
only expire, revalidate, or change URL.

## Stale-While-Revalidate And ISR

Stale-while-revalidate is required behavior for the shared origin cache, not an
optional query hint. A shared cache record needs at least two deadlines:

```ts
type SharedCacheRecord<T> = {
  freshUntil: number;
  staleUntil: number;
  tags: readonly CacheTag[];
  value: T;
};
```

Given `ttl: "5m"` and `staleWhileRevalidate: "1h"`:

- before five minutes, return the fresh value;
- from five through sixty-five minutes, return the stale value immediately and
  start one background refresh;
- after sixty-five minutes, block on a refresh because the stale window ended;
- publish a refreshed value atomically only after its producer succeeds;
- if a background refresh fails, retain the last good value through its stale
  window, report the error, and permit a later refresh attempt.

The one-refresh rule holds through the shared store, not merely inside one Node
process. `CacheStore` exposes a refresh lease, token-checked publication, and
token-checked release capability. Publication succeeds only for the current
lease owner. Key and tag invalidation cancel the lease, preventing an in-flight
refresh from resurrecting invalidated data. A custom store that omits these
coordination methods remains usable for ordinary TTL caching but fails clearly
if it encounters a stale-while-revalidate entry.

Background refresh also needs runtime lifetime. `createCache(...)`,
`createMemoryCache(...)`, and request-handler `cacheStore` configuration accept
`waitUntil`, allowing a long-running Node adapter to track the promise and a
serverless or edge adapter to pass it to its execution context. They also accept
`onBackgroundError`; a failed refresh retains the stale value and reports the
error. Without an error hook, Demiurge logs the failure rather than creating an
unhandled rejection.

Incremental static regeneration is the same state machine applied to a render
artifact instead of a query value:

1. Return the last successfully generated artifact while it is inside its stale
   window.
2. Regenerate at most once for that key across the deployment.
3. Atomically replace the artifact only after rendering, serialization, and all
   required validation succeed.
4. Keep serving the last good artifact if regeneration fails.
5. Generate the per-response document nonce after the artifact lookup; never
   store it in the reusable artifact.

For a fully prerendered route, the ISR value is the body/bootstrap/metadata
artifact. For partial prerendering, the cached prelude and React postponed state
are one indivisible value: publishing one without the other would make resume
operate against a different tree. SSR may use the same render-artifact cache,
although “ISR” conventionally describes regeneration of prerendered output.
Streaming misses may be recorded only after successful completion; hits use the
materialized artifact and no longer reproduce the original reveal timing.

Time-based regeneration and event-based regeneration are separate triggers for
the same state machine. Tag or key invalidation needs two explicit behaviors:

- mark stale, so the next read may serve the last value and trigger background
  regeneration;
- expire now, so the next read blocks until a new value succeeds.

The existing invalidation API deletes entries and therefore implements only the
second behavior. A future revalidation API must not overload deletion and make
the availability tradeoff implicit.

Origin ISR does not automatically revalidate copies already stored at a CDN or
browser. An adapter may connect framework tags to provider purge/surrogate-key
APIs, but without that capability the outer cache keeps its response until its
own TTL ends. Browser responses cannot be actively purged.

## Cache Backend

### Core and provider integration boundary

Demiurge core owns cache semantics, namespacing, public contracts, capability
checks, and adapter conformance tests. It must stay usable without installing a
cloud or database SDK. Provider-specific construction belongs in optional
integration packages: Redis, Cloudflare KV/Durable Objects, Vercel KV, and
similar packages own credentials, SDK clients, retries, provider limits, and
deployment wiring while implementing the same core contracts.

This split is deliberate. Shipping every provider in core would increase
install size, dependency risk, and release coupling for users who do not use
those services. Leaving everything to applications would fragment semantics
and make `public`, `private`, invalidation, idempotency, and refresh guarantees
mean different things per adapter. A small, honest core contract plus optional
provider packages gives integrations a shared behavioral bar without bundling
the ecosystem into the framework.

The configured cache backend is for framework cache semantics, not arbitrary
app storage. Custom backends implement the published async `CacheStore`
contract:

```ts
type CacheStore = {
  get(key: string): CacheStoreEntry | undefined | Promise<CacheStoreEntry | undefined>;
  set(key: string, entry: CacheStoreEntry): void | Promise<void>;
  delete(key: string): boolean | Promise<boolean>;
  invalidateTags(tags: readonly string[]): number | Promise<number>;
  acquireRefreshLease?(key: string, token: string, expiresAt: number): boolean | Promise<boolean>;
  publishRefresh?(key: string, token: string, entry: CacheStoreEntry): boolean | Promise<boolean>;
  releaseRefreshLease?(key: string, token: string): void | Promise<void>;
};
```

`CacheStoreEntry.expiresAt` is the fresh deadline and `staleUntil` is the final
retention deadline. Both are epoch-millisecond numbers or `null`, so the
contract remains JSON-safe instead of relying on `Infinity`. The three optional
refresh methods are an all-or-nothing capability required by
`staleWhileRevalidate`; provider implementations must make lease acquisition and
token-checked publication atomic in their own storage system.

Cache and idempotency keys accept only JSON-like primitives, dense arrays, and
plain objects with enumerable string data properties. Array holes, custom or
symbol properties, and accessors are rejected so every accepted runtime value
has one unambiguous serialization. Numbers must be finite; negative zero is
rejected rather than silently colliding with zero. Runtime JavaScript callers also fail before store access
when a key contains `undefined`, functions, symbols, special object instances,
non-enumerable properties, or circular references.

Create one shared store and inject it into the request handler. The handler
creates a fresh cache facade for every request:

```ts
import { createMemoryCacheStore, createRequestHandler } from "demiurge";

const store = createMemoryCacheStore();
const handler = createRequestHandler({
  cacheStore: {
    namespace: {
      app: "storefront",
      environment: process.env.NODE_ENV ?? "development",
      schemaVersion: 1,
    },
    onBackgroundError: (error) => logger.error(error),
    store,
    waitUntil: (promise) => backgroundTasks.add(promise),
  },
  routes,
});
```

With `cacheStore` configured, `build`, `public`, and `private` entries can
outlive a request and can be shared by multiple handler instances using the
same backend and namespace. `request` remains local to each handler invocation,
and `none` always executes the source. Omitting `cacheStore` preserves the safe
default: every request receives a new memory cache, so even a `public` query
does not silently create process-global state.

The built-in memory store is useful for one Node process and tests. It is not a
distributed cache: multiple replicas need a Redis/KV-style implementation of
the same `CacheStore` contract.

Both memory APIs are bounded to 10,000 entries by default and accept
`maximumEntries` when a process has a deliberately larger or smaller memory
budget. The cache store opportunistically removes values after their stale
retention deadline and evicts the oldest remaining value at capacity without
running a background timer.
Idempotency results default to a finite 24-hour TTL; configure `defaultTtl` or a
request-specific `ttl`. Their TTL starts only after the mutation completes,
and in-flight mutations are neither expired nor evicted. If every slot is
in-flight, a new distinct mutation fails closed instead of exceeding the bound.

The namespace is required for shared adapters and serializes as
`app:environment:schemaVersion`. Demiurge adds that namespace and the cache
scope to every key and tag before calling the store. Redis/KV adapters therefore
cannot namespace values but accidentally leave their tag index global. Change
`schemaVersion` when the stored value shape changes; rolling revisions then use
independent key spaces.

Lower-level integrations can construct a facade directly with
`createCache({ namespace, store })`. Adapter authors can run the same
conformance checks as the framework memory
store without depending on a test runner:

```ts
import {
  verifyCacheStoreContract,
  verifyCacheStoreRefreshContract,
} from "demiurge/data/testing";

await verifyCacheStoreContract(() => createMyStore());
await verifyCacheStoreRefreshContract(() => createMyStore());
```

The base verifier checks missing reads, set/get replacement, tag invalidation,
deletion counts, preservation of entry metadata, and async implementations. The
refresh verifier checks mutual exclusion, owner-only publication, token-safe
release, and invalidation cancellation. Each invocation uses unique keys and
cleans them up.

Provider-specific Redis and KV constructors are not implemented yet. Today an
adapter implements `CacheStore`, verifies it with the published contract, and
passes it to `createCache(...)`; future provider helpers will wrap that same
interface rather than introduce a second cache API.

The app should receive a structured cache API, not the raw Redis/KV client.

Allowed:

```ts
await cache.get(postBySlug(slug));
```

Avoid:

```ts
await cache.redis.set("whatever", value);
```

A future typed cache-domain helper may provide app-level derived caching, but it
is not part of the current public API.

## Invalidation

Server-side invalidation:

```ts
const invalidate = createInvalidation(cache);

await invalidate.tags([tags.posts()]);
await invalidate.key(["post", slug]);
```

`createInvalidation(...)` exposes `key(...)`, `keys(...)`, `tag(...)`, and
`tags(...)` methods that resolve to deterministic `{ kind, deleted }` results.
Invalidation is async because production stores are usually network services.
Path-level invalidation and client router refresh still remain separate future
concerns.

Client-side React should not mutate the shared cache directly. Client code calls
typed actions or server functions:

```tsx
const createPost = useAction(actions.posts.create);
await createPost.submit({ title: "Hello" });
```

The server action performs invalidation:

```ts
export const create = action({
  input: actionInput.json,
  idempotency: {
    key: ({ request }) => ["create-post", request.headers.get("idempotency-key")],
    store: idempotency,
    ttl: "24h",
  },

  async handler({ input, invalidate, routes }) {
    const post = await db.posts.create(input);
    await invalidate.tags([tags.posts()]);
    return redirect({ to: "/posts/[slug]", path: { slug: post.slug } });
  },
});
```

The first action slice exposes `action(...)` and `actionInput` helpers for
JSON, form data, and text request bodies. Actions return existing response
capabilities or platform `Response` objects, and can opt into the idempotency
store so retrying the same mutation key replays the original response instead
of running the handler again. Typed schema validation, client submission
helpers, and automatic invalidation context still need dedicated slices.

Client router refresh/prefetch and server data-cache invalidation should be
separate concepts.

## Idempotent Mutations

Retryable mutations should be guarded by client-provided idempotency keys:

```ts
const idempotency = createMemoryIdempotencyStore();

const result = await runIdempotentMutation(idempotency, {
  key: ["create-post", request.headers.get("idempotency-key")],
  ttl: "24h",
  fn: () => db.posts.create(input),
});
```

The first idempotency slice exposes `createMemoryIdempotencyStore(...)` and
`runIdempotentMutation(...)`. The memory store dedupes in-flight work, replays
completed results for matching keys until TTL expiry, and removes failed
mutations so callers can retry after transient errors.

## Typed Routes, Redirects, And Tags

Route files should generate a typed route manifest:

```ts
href("/")
href("/posts")
href({ to: "/posts/[slug]", path: { slug } })
href({ to: "/org/[orgId]/settings", path: { orgId } })
```

Use it everywhere:

```tsx
<Link to="/posts/[slug]" path={{ slug }}>Read post</Link>
```

```ts
return redirect({ to: "/posts/[slug]", path: { slug } });
invalidate.path({ to: "/posts/[slug]", path: { slug } });
```

Cache tags should also be typed:

```ts
export const tags = defineTags({
  posts: tag<void>("posts"),
  post: tag<{ slug: string }>((input) => `post:${input.slug}`),
});
```

## Static Generation

Static sites need to turn dynamic route patterns into concrete paths at build
time.

For a route:

```txt
routes/blog/[slug].ts
```

the framework needs:

```ts
[{ slug: "hello-world" }, { slug: "file-routing" }]
```

Then it can emit:

```txt
dist/blog/hello-world/index.html
dist/blog/file-routing/index.html
```

The simplest API is probably a plain `paths` export:

```ts
export const paths = async ({ cache }) => {
  const posts = await cache.get(allPostSlugsQuery());
  return posts.map((post) => ({ slug: post.slug }));
};

export const GET = page({
  render: { mode: "static" },
  data: async ({ path, cache }) => ({
    post: await cache.get(postBySlug(path.slug)),
  }),
  view: ({ data }) => <PostPage post={data.post} />,
});
```

This is more precise than `params` and more minimal than
`defineStaticParams(...)`. Add a helper only if it unlocks better inference or
validation.

The static paths collector includes non-dynamic page routes automatically,
requires dynamic page routes to export `paths`, validates every dynamic and
catchall variable, and expands entries into encoded concrete pathnames.

The production static adapter consumes that collector through
`generateStaticOutput(...)`. It renders every concrete pathname through the
same request, policy, data, layout, metadata, and document pipeline used by a
runtime server, then emits pretty-URL files such as
`dist/blog/hello-world/index.html`. It also emits an app-owned `404.html` and a
versioned `demiurge-static-manifest.json` containing the effective response
headers for each artifact.

Generation is staged before publication, preserves existing client assets, and
removes only HTML files listed by the previous valid static manifest. The build
fails on render errors, redirects, cookies, non-HTML responses, duplicate or
non-portable paths, nonce-backed CSP, and inline scripts/styles missing their
declared CSP hash. Hosts remain responsible for translating the manifest's
headers into their provider-specific configuration.

Use this vocabulary:

- `path`: runtime variables extracted from dynamic path segments.
- `paths`: build-time list of concrete dynamic path variable sets to generate.
- `search`: URL search parameters from the query string.

Avoid using `params` in public APIs unless there is a very specific reason.

### Paginated Archive Pages

Pagination here means generated archive URLs, not paginating the build itself:

```txt
/blog/page/1
/blog/page/2
/blog/page/3
```

For:

```txt
routes/blog/page/[page].ts
```

the route can return:

```ts
export const paths = async () => {
  const totalPosts = await cms.countPosts();
  const pages = Math.ceil(totalPosts / 20);

  return Array.from({ length: pages }, (_, index) => ({
    page: String(index + 1),
  }));
};
```

If a CMS API itself is paginated, the user can loop inside `paths`. That is data
source logic, not a separate framework primitive.

## Prior Art

- Next.js uses `generateStaticParams()` for dynamic routes and runs it before
  corresponding layouts/pages during build.
- Astro requires `getStaticPaths()` for dynamic routes in static mode.
- SvelteKit prerenders by crawling entry points and supports an `entries`
  function for dynamic routes.
- Gatsby can create dynamic pages through its File System Route API or the
  programmatic `createPages` Node API.
