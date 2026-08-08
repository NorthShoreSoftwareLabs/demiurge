# Route Policies And Middleware

Status: in progress

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

## Implemented Slices

- Route groups such as `(admin)` organize route files and framework-attached
  files without changing generated URLs or runtime path matching.
- `@policy.ts` files are discovered as framework-attached policy files, while
  ordinary `policy.tsx` files remain real URL routes.
- Inherited `@policy.ts` route security is merged root-to-leaf and enforced by
  the HTTP request handler before route handlers run.
- Inherited `@middleware.ts` files run root-to-leaf around HTTP route handlers
  and can short-circuit with a platform `Response`.
- Inherited app-owned `@loading.tsx` and `@not-found.tsx` files render browser
  loading and not-found fallbacks without framework-owned markup.

## Open Decisions

- Whether middleware can short-circuit with any response capability or only a
  platform `Response`.
