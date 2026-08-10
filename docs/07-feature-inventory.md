# Feature Inventory

This file tracks every major feature family discussed so far. Status values:

- `implemented`: works in the `0.0.1` prototype.
- `designed`: documented API direction, not implemented.
- `planned`: identified as important, needs deeper design.

Executable feature work now lives in `tasks/`. Keep this file as the inventory
snapshot and update the matching task file when a feature moves toward
implementation.

## Routing

| Feature | Status |
| --- | --- |
| File-based route discovery | implemented |
| Framework package public API from `demiurge` | implemented |
| Split source modules: `route`, `router`, `browser`, `internal` | implemented |
| `GET = page(...)` route capability | implemented |
| HTTP request handler for response capabilities | implemented |
| Vite plugin for non-page HTTP route capabilities | implemented |
| `@layout.tsx` nested layouts | implemented |
| App-provided loading/not-found browser fallback options | implemented |
| Inherited `@loading.tsx`, `@not-found.tsx`, and `@error.tsx` | implemented |
| Server-rendered not-found document inside inherited layouts | implemented |
| Layout-free not-found fallback when a layout throws | implemented |
| Content-negotiated not-found: document or RFC 9457 problem+json | implemented |
| Build gate requiring a root `@not-found.tsx` for page apps | implemented |
| Error pipeline split by failure site | implemented |
| Dev error document with stack, opaque production body | implemented |
| Typed HTTP errors mapping to problem+json or error documents | implemented |
| Dynamic path variables with `[slug]` | implemented |
| Catchall path variables with `[...path]` | implemented |
| `path` instead of public `params` vocabulary | implemented |
| Real API route helpers: `json`, `text`, `html` | implemented |
| Redirect and not-found helpers | implemented |
| Raw `response(...)` helper | implemented |
| SSE/JSONL/readable stream helpers | implemented |
| WebSocket `WS` capability | designed |
| WebTransport capability | planned |
| WebRTC signaling helpers | planned |
| Route groups such as `(admin)` | implemented |
| HTTP `@middleware.ts` cascade | implemented |
| Typed middleware-added context | designed |
| Framework-attached `@policy.ts` discovery | implemented |
| HTTP route security `@policy.ts` cascade | implemented |
| Declarative `@policy.ts` cascade | designed |
| Generated typed URL manifest | implemented |
| Actual URL string type-safety for `Link`/`href` | implemented |
| Manual typed route builders | rejected |
| Typed path/search inference | designed |
| Unit tests for route matching and loading | implemented |
| Framework testing strategy | designed |

## Rendering

| Feature | Status |
| --- | --- |
| Client-side page rendering | implemented |
| SPA navigation | implemented |
| SSR | implemented |
| Streaming SSR | implemented |
| React Server Components | designed |
| RSC Flight as data stream | designed |
| Static prerendering | implemented |
| Partial prerendering with strict CSP compatibility checks | designed |
| Hydration modes: none/page/islands | designed |

## Data

| Feature | Status |
| --- | --- |
| Route-level `data` for page `GET` | partially implemented |
| Component-level server data through request context | designed |
| Reusable `query(...)` objects | implemented |
| Explicit cache API | implemented |
| Cache scopes: build/public/private/request/none | implemented |
| Cache adapters: memory/Redis/KV/custom | partially implemented |
| Public custom cache-store contract and conformance verifier | implemented |
| Request-handler shared cache injection with request isolation | implemented |
| Typed tags and invalidation | implemented |
| Client router refresh/prefetch separate from server invalidation | designed |
| Actions/mutations | partially implemented |
| Idempotency for retryable mutations | implemented |
| Static `paths` export for dynamic static generation | implemented |

## Security

| Feature | Status |
| --- | --- |
| Strict security preset | designed |
| CSP nonce mode | implemented |
| CSP hash mode for static output | partially implemented |
| CSP auto mode for static/dynamic split | designed |
| Strict CSP for streaming SSR | implemented |
| Strict CSP for RSC | designed |
| Security report endpoint | implemented |
| Typed CORS | designed |
| CSRF defaults for cookie-auth unsafe methods | implemented |
| Rate limiting | designed |
| Request size limits | designed |
| Upload limits | implemented |
| WebSocket origin checks | implemented |
| Webhook verification helpers | designed |
| Trusted Types report-only mode | designed |
| Trusted Types enforce mode | designed |
| COOP/COEP/CORP cross-origin isolation preset | designed |
| Secret/env validation | implemented |
| Dependency/script audit | implemented |

## Document Output

| Feature | Status |
| --- | --- |
| `defineMetadata` | implemented |
| Cascading layout-to-route metadata | implemented |
| Title defaults and `format` callback | implemented |
| Structured custom `meta(...)` and `link(...)` | implemented |
| `defineScripts` for static script contributions | implemented |
| Managed `<Script />` | designed |
| Static versus render-discovered script model | designed |
| Resource hints: preload/preconnect/modulepreload | implemented |
| Structured data | implemented |
| Sitemap and robots generation | partially implemented |
| OG image generation | partially implemented |

## Platform Features

| Feature | Status |
| --- | --- |
| Image optimization | partially implemented |
| Remote image allowlists | implemented |
| Font optimization and self-hosted fonts | partially implemented |
| Analytics integrations | partially implemented |
| GTM integration with trust-boundary audit | partially implemented |
| Sentry/PostHog/Plausible integrations | planned |
| OpenTelemetry instrumentation | partially implemented |
| Core Web Vitals reporting | designed |
| Server-Timing headers | implemented |
| Route audit/devtools UI | designed |

## Adapters

| Feature | Status |
| --- | --- |
| Node adapter | implemented |
| Edge adapter | planned |
| Static adapter | implemented |
| Adapter capability checks | implemented |
| Cloud Run deployment guidance | planned |
| Shared cache adapters such as Redis | designed |
