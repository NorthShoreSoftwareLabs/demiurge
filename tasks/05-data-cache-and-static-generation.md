# Data Cache And Static Generation

Status: in progress

## Goal

Data access should be explicit, typed, cache-aware, and usable from route
handlers and React server components without hiding when work runs.

## Features To Implement

- Route-level `data` for page `GET`.
- Component-level server data through request context.
- `query(...)` objects with typed return values and typed invalidation tags.
- Cache scopes: build, public, private, request, none.
- Cache adapters: memory, Redis, KV, custom.
- Framework-owned internal cache namespace with a separate optional user cache
  API later if it earns its keep.
- Typed invalidation from server actions, route handlers, and React server code.
- Static `paths` export for dynamic static generation using `path` vocabulary,
  not public `params`.
- Build-time validation that dynamic static routes provide `paths`.
- Clear distinction between build-time static generation and runtime server
  rendering.

## Examples Required

- `examples/static-blog`
- `examples/runtime-server-data`
- `examples/cache-invalidation`
- `examples/redis-cache-adapter`

## Tests Required

- Unit tests for cache key/tag behavior.
- Type tests for `paths`, route path values, and invalidation helpers.
- Fixture build tests for static dynamic routes.
- Adapter contract tests for shared cache behavior.

## Implemented Slices

- `query(...)` creates typed reusable cache requests with stable keys, tags,
  scopes, TTLs, and typed return values.
- `createMemoryCache(...)` provides a framework-owned memory cache with
  request-scoped dedupe, shared build/public/private entries, `none` bypass,
  TTL expiry, and key/tag invalidation.
- `tag(...)`, `defineTags(...)`, `serializeCacheKey(...)`, and
  `parseCacheDuration(...)` cover the first cache key/tag behavior tests.

## Open Decisions

- Whether a public user cache API ships separately from the internal framework
  cache adapter.
