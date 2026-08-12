# Feature Inventory

This file tracks every major feature family discussed so far. Status values:

- `implemented`: works in the current framework release and is covered by the
  matching tests or production probe.
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
| SPA navigation with server data transport and supersession safety | implemented |
| Client/server page-data compiler boundary | implemented |
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
| Route-level `data` for page `GET` | implemented |
| Component-level server data through request context | designed |
| Reusable `query(...)` objects | implemented |
| Explicit cache API | implemented |
| Cache scopes: build/public/private/request/none | implemented |
| Memory and public custom cache adapters | implemented |
| Provider Redis/KV cache packages | designed |
| Public custom cache-store contract and conformance verifier | implemented |
| Request-handler shared cache injection with request isolation | implemented |
| Shared stale-while-revalidate with distributed refresh coordination | implemented |
| Origin render-artifact cache and incremental static regeneration | designed |
| CDN/browser cache policy and adapter-aware purge | designed |
| Typed tags and invalidation | implemented |
| Client router refresh/prefetch separate from server invalidation | designed |
| Actions/mutations | partially implemented |
| Idempotency for retryable mutations | implemented |
| Static `paths` export for dynamic static generation | implemented |

## Security

| Feature | Status |
| --- | --- |
| Strict security preset | implemented |
| CSP nonce mode | implemented |
| CSP hash mode for static output | partially implemented |
| CSP auto mode for static/dynamic split | designed |
| Strict CSP for streaming SSR | implemented |
| Strict CSP for RSC | designed |
| Reporting-Endpoints and CSP report-to/report-uri configuration | implemented |
| Security report endpoint (`application/csp-report` and `application/reports+json`) | implemented |
| Typed CORS | implemented |
| CSRF defaults for cookie-auth unsafe methods | implemented |
| Rate limiting | implemented |
| Request size limits | implemented |
| Upload limits | implemented |
| WebSocket origin checks | implemented |
| Webhook verification helpers | implemented |
| Trusted Types report-only mode | implemented |
| Trusted Types enforce mode | implemented |
| COOP/COEP/CORP cross-origin isolation preset | implemented |
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
| Typed observability event dispatcher (manual calls only) | implemented |
| Automatic framework instrumentation and OpenTelemetry context | planned |
| Feature flags and A/B experimentation | planned |
| Core Web Vitals reporting | designed |
| Server-Timing headers | implemented |
| Route audit/devtools UI | designed |

## Adapters

| Feature | Status |
| --- | --- |
| Node adapter | implemented |
| Node trusted-proxy, allowed-host, abort, and lifecycle controls | implemented |
| Edge adapter | planned |
| Static adapter | implemented |
| Adapter capability checks | implemented |
| Cloud Run deployment guidance | planned |
| Shared cache adapters such as Redis | designed |
| GCP/AWS runtime, state, and gateway integration packages | planned |
| Typed multi-target deployment profiles | planned |
| Demiurge-owned build CLI and versioned artifact manifest on Vite | planned |
| Internal Vite Environment API abstraction | planned |
