# Route Policies And Middleware

Tracking: #5

## Goal

Shared route behavior should compose without duplicating logic in every route,
while preserving file-based routing and allowing real URL files like
`policy.ts`.

## Features To Implement

- `@middleware.ts` cascade with segment inheritance.
- `@policy.ts` cascade for declarative settings.
- Route groups such as `(admin)` that organize files without changing URLs.
- Explicit ordering rules for middleware and policies.
- Typed request context enriched by middleware.
- App-owned `@loading.tsx`, `@not-found.tsx`, and `@error.tsx` inheritance.
- Deterministic positional route specificity and manifest-time rejection of
  group-erased or parameter-renamed runtime shape collisions (#107).

## Examples Required

- `examples/nested-policies`
- `examples/admin-route-group`
- `examples/app-owned-fallbacks`

## Tests Required

- Unit tests for cascade ordering.
- Type tests for middleware-added context.
- Fixture tests proving `policy.ts` remains a real `/policy` route and
  `@policy.ts` remains framework-attached.

## Open Decisions

None open.

## Decisions Made

- Route matching never uses filenames as a runtime tiebreaker. Static,
  dynamic, and terminal catchall segments have positional precedence;
  equal-shape ties are rejected with both files and a witness URL.

- Middleware short-circuits with any response capability, and `page(...)` is a
  type error (#35). Middleware runs after matching and already holds the
  `HttpRouteContext` that `toResponse(...)` needs, so the machinery costs
  nothing. A page is the exception because the nonce is minted and the security
  headers applied outside the middleware chain, and because a page returned
  from middleware would carry no document plan. `notFound()` needs the manifest
  threaded into the middleware runner.
