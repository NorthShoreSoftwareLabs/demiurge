# Route Policies And Middleware

Status: planned

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

- Whether middleware can short-circuit with any response capability or only a
  platform `Response`.
