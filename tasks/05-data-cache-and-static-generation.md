# Data Cache And Static Generation

Tracking: #7

## Goal

Data access should be explicit, typed, cache-aware, and usable from route
handlers and React server components without hiding when work runs.

## Features To Implement

- Route-level `data` for page `GET`.
- Component-level server data through request context.
- `query(...)` objects with typed return values and typed invalidation tags.
- Cache scopes: build, public, private, request, none.
- ~~Stale-while-revalidate for shared data entries, with stale retention on
  refresh failure, store-coordinated refresh leases, atomic publication, and
  adapter-managed background lifetime.~~ Shipped for data-query results in
  #112, including Node `waitUntil` tracking and bounded graceful-shutdown drain;
  render-artifact ISR remains separate work.
- Origin render-artifact caching and incremental static regeneration, using the
  same freshness, stale-window, tag, and atomic-publication semantics as data
  caching.
- Cache adapters: memory, Redis, KV, custom. The public custom-store contract
  and conformance verifier shipped in #47.
- Keep provider SDKs out of core. Core owns semantics, contracts, capability
  checks, and conformance; optional integration packages own provider clients,
  credentials, retries, limits, and deployment wiring.
- One public cache API, with the framework holding its own instances rather than
  a reserved namespace inside the app's.
- Typed invalidation from server actions, route handlers, and React server code.
- Static `paths` export for dynamic static generation using `path` vocabulary,
  not public `params`.
- Build-time validation that dynamic static routes provide `paths`.
- Clear distinction between build-time static generation and runtime server
  rendering.
- Explicit separation between origin/store caching, shared HTTP/CDN caching,
  and browser caching; invalidation may cross layers only through an adapter
  that actually supports the required purge operation.

## Examples Required

- `examples/static-blog`
- ~~`examples/runtime-server-data`~~ Shipped in #49 with a production probe for
  cache scopes, account partitioning, and TTL expiry.
- ~~Node stale-while-revalidate lifecycle~~ Shipped in `examples/node-server`:
  the shared home query has fresh/stale deadlines, and its refresh promise is
  tracked by the Node server through graceful shutdown.
- `examples/cache-invalidation`
- `examples/redis-cache-adapter`

## Tests Required

- Unit tests for cache key/tag behavior.
- Collision tests prove injective serialization across accepted nested values;
  runtime validation rejects non-finite numbers, negative zero, sparse or
  customized arrays, accessors, hidden state, symbols, and non-plain objects
  before cache or idempotency store access (#105).
- Type tests for `paths`, route path values, and invalidation helpers.
- Fixture build tests for static dynamic routes.
- ~~Adapter contract tests for shared cache behavior.~~ The store-level contract
  verifier shipped in #47; request-lifetime behavior remains tracked by #88.

## Open Decisions

None open.

## Decisions Made

- The cache API is public and already shipped (#48). The framework keeps its own
  cache instances rather than a reserved namespace inside the app's, so there is
  no shared key space to police.
- Isolation is per instance, and every shared-store adapter has to build it
  (#47). The memory adapter gets it free by closing over a `Map`; two Redis
  adapters against one Redis do not. So the framework builds every key and
  adapters receive strings, which removes the code path where an author
  namespaces values and forgets the tag index.
- Namespaces are `app:environment:schemaVersion` and required, never defaulted.
  `app:environment` is developer-supplied because it is the only identity that
  separates another instance of this app from someone else's app. The schema
  version sits in the prefix rather than behind a compatibility check, because
  rolling deploys run two revisions at once and versioned prefixes make them
  invisible to each other instead of corrupting each other.
- No mutual-exclusion lock on a namespace. Many instances of one revision need
  it simultaneously, and a lock cannot tell autoscaling from a collision.
- `CacheStore` operations are async-capable and receive only fully namespaced,
  scope-qualified keys and tags. Request entries never reach the store. Cache
  invalidation is consequently async, and `demiurge/data/testing` publishes a
  runner-neutral verifier custom adapters can execute (#47).
- `createRequestHandler({ cacheStore: { namespace, store } })` creates one
  cache facade per request. Shared scopes use the injected backend across
  requests and handler instances; `request` and `none` never leak into it. With
  no store configured, each request keeps the previous isolated memory-cache
  behavior (#88).
