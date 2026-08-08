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
| Dynamic path variables with `[slug]` | implemented |
| Catchall path variables with `[...path]` | implemented |
| `path` instead of public `params` vocabulary | implemented |
| Real API route helpers: `json`, `text`, `html` | implemented |
| Redirect and not-found helpers | implemented |
| Raw `response(...)` helper | implemented |
| SSE/JSONL/readable stream helpers | designed |
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
| SSR | designed |
| Streaming SSR | designed |
| React Server Components | designed |
| RSC Flight as data stream | designed |
| Static prerendering | designed |
| Partial prerendering with strict CSP compatibility checks | designed |
| Hydration modes: none/page/islands | designed |

## Data

| Feature | Status |
| --- | --- |
| Route-level `data` for page `GET` | designed |
| Component-level server data through request context | designed |
| Reusable `query(...)` objects | designed |
| Explicit cache API | designed |
| Cache scopes: build/public/private/request/none | designed |
| Cache adapters: memory/Redis/KV/custom | designed |
| Typed tags and invalidation | designed |
| Client router refresh/prefetch separate from server invalidation | designed |
| Actions/mutations | designed |
| Idempotency for retryable mutations | designed |
| Static `paths` export for dynamic static generation | designed |

## Security

| Feature | Status |
| --- | --- |
| Strict security preset | designed |
| CSP nonce mode | designed |
| CSP hash mode for static output | designed |
| CSP auto mode for static/dynamic split | designed |
| Strict CSP for streaming SSR | designed |
| Strict CSP for RSC | designed |
| Security report endpoint | designed |
| Typed CORS | designed |
| CSRF defaults for cookie-auth unsafe methods | designed |
| Rate limiting | designed |
| Request size limits | designed |
| Upload limits | designed |
| WebSocket origin checks | designed |
| Webhook verification helpers | designed |
| Trusted Types report-only mode | designed |
| Trusted Types enforce mode | designed |
| COOP/COEP/CORP cross-origin isolation preset | designed |
| Secret/env validation | planned |
| Dependency/script audit | planned |

## Document Output

| Feature | Status |
| --- | --- |
| `defineMetadata` | implemented |
| Cascading layout-to-route metadata | implemented |
| Title defaults and `format` callback | implemented |
| Structured custom `meta(...)` and `link(...)` | implemented |
| `defineScripts` | designed |
| Managed `<Script />` | designed |
| Static versus render-discovered script model | designed |
| Resource hints: preload/preconnect/modulepreload | designed |
| Structured data | designed |
| Sitemap and robots generation | designed |
| OG image generation | designed |

## Platform Features

| Feature | Status |
| --- | --- |
| Image optimization | designed |
| Remote image allowlists | designed |
| Font optimization and self-hosted fonts | designed |
| Analytics integrations | designed |
| GTM integration with trust-boundary audit | designed |
| Sentry/PostHog/Plausible integrations | planned |
| OpenTelemetry instrumentation | designed |
| Core Web Vitals reporting | designed |
| Server-Timing headers | planned |
| Route audit/devtools UI | designed |

## Adapters

| Feature | Status |
| --- | --- |
| Node adapter | planned |
| Edge adapter | planned |
| Static adapter | planned |
| Adapter capability checks | designed |
| Cloud Run deployment guidance | planned |
| Shared cache adapters such as Redis | designed |
