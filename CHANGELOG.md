# Changelog

Released framework changes are grouped below by version. Open work and delivery
status live in GitHub issues and milestones.

## 0.1.1 — 2026-08-14

- Development SSR now supports route files that import the `meta` helper and
  also read `import.meta.env` (#124).
- The development server now serves the framework client entry. Page apps now
  hydrate on normal pages and application-owned not-found pages (#128).
- Packed Vite applications now load the optimized React DOM client correctly
  during development hydration (#133).
- The development server now gives Vite-managed scripts and styles a
  request-local CSP nonce. Application-authored inline content remains
  untrusted (#129).
- SSR builds now use the supported Node 22.13 target by default. Explicit Vite
  build targets remain unchanged (#125).
- The Vite plugin now disables automatic asset inlining by default. This change
  keeps generated asset URLs compatible with the default CSP (#127).
- Static output now adds CSP hashes for framework-rendered structured data.
  Application-authored inline scripts still require explicit hashes (#130).
- Static manifests now declare immutable caching for hashed files. Other files
  use a revalidating policy (#126).
- Static output now emits fixed text, HTML, and JSON routes. It rejects routes
  that require a runtime adapter (#132).

## 0.1.0 — 2026-08-13

## Pipeline Quality Gates

Epic: #1

- The library lives in `packages/core` as a pnpm workspace. The examples depend
  on it by name. Resolution uses `node_modules` and the package `exports` map.
- The package builds to `dist` with emitted declarations, and `react`,
  `react-dom`, and `vite` are peer dependencies rather than bundled runtime
  dependencies.
- `pnpm test:pack` packs the tarball, installs it into a scratch app, and
  imports every declared entry point. It is the only gate that exercises
  packaging the way a consumer experiences it.

## Security Policy And CSP

Epic: #4

- Public `security` helpers for strict, API, and cross-origin-isolated presets.
- The strict preset sends one year of HSTS on HTTPS responses without opting
  subdomains into the policy or enrolling the domain in browser preload lists.
- `defineSecurityPolicy(...)` and `mergeSecurityPolicies(...)` for app/layout/
  route policy cascade.
- `createSecurityHeaders(...)` for deterministic CSP, security header, HSTS,
  and Trusted Types header rendering.
- Strict CSP nonce substitution fails closed when the nonce is missing.
- Static CSP preset and `cspHash(...)` helper for build-time hash-based CSP.
- Helper-attached CORS policy, actual response CORS headers, generated
  preflight responses, and wildcard-plus-credentials validation.
- Helper-attached request body limits reject oversized declarations before a
  read and count actual bytes for chunked or understated bodies as they are
  consumed.
- Helper-attached request allowed-method policy enforced before route handlers
  run.
- Helper-attached fixed-window rate limits with pluggable server storage and
  bounded, expiration-aware in-memory storage.
- The Node adapter requires an allowed-host policy and ignores forwarded headers
  by default. One typed proxy-trust policy resolves the client connection data.
  The policy accepts a hop count or CIDR. IP rate limits use the resolved peer.
- The Node server exposes typed timeout configuration, readiness state, and a
  bounded graceful `shutdown()` with optional SIGINT/SIGTERM registration.
  `waitUntil(...)` keeps cache refreshes and other tracked background work alive
  through the same bounded drain. It aborts Web Requests on premature client
  disconnect so route and render work can cancel promptly.
- Default double-submit CSRF protection for cookie-authenticated unsafe methods,
  configurable cookie/header token names, explicit route-policy exemptions,
  and secure token/cookie issuance helpers with browser round-trip coverage.
- Generic HMAC webhook helper that uses Web Crypto to verify exact request bytes.
  It supports padded base64 and explicit prefixes. It rejects invalid signatures
  before the application handler runs.
- `createSecurityAudit(...)` for rendered header snapshots, effective route
  policy inspection, and structured security findings.
- `createSecurityAudit(...)` reports document static scripts that are missing
  required CSP nonces or are not allowed by the effective `script-src` policy.
- `defineEnvSchema(...)`, `env.*(...)`, and `validateEnv(...)` validate runtime
  configuration and secrets before request handling starts.
- `auditScriptDependencies(...)` and opt-in `createSecurityAudit(...)` checks
  warn about undeclared third-party script purposes and missing integrity. They
  also warn about early execution and the wide Google Tag Manager trust boundary.
- `createSecurityReportHandler(...)` provides a POST-only CSP/Reporting API
  report ingestion helper for `application/csp-report` and
  `application/reports+json`, with media-type validation, optional body-size
  enforcement, and per-report callbacks.
- Typed reporting configuration validates endpoint names and targets. It emits
  deterministic headers for `Reporting-Endpoints`, `report-to`, and `report-uri`.
  It adds reporting directives to Trusted Types report-only CSP. It also warns
  when report-only mode has no target (#113).
- `validateUploads(...)` validates parsed `FormData` files against required
  fields, per-file size limits, aggregate size limits, and MIME/type allowlists.
- Cache and idempotency keys reject non-finite numbers, negative zero, and
  unsupported runtime values instead of allowing JSON serialization collisions.
- In-memory cache and idempotency stores sweep expired entries, have configurable
  finite entry ceilings, and deterministically evict the oldest completed value.
  Idempotency defaults to a 24-hour result TTL that begins after completion.
  in-flight mutations never expire or get evicted.
- Shared data caches implement `staleWhileRevalidate` with separate fresh and
  stale deadlines. Stores coordinate refresh leases and permit only the owner to
  publish. Invalidation safely cancels refresh work. Failed refreshes retain
  stale data (#112).

## Route Policies And Middleware

Epic: #5

- Route groups such as `(admin)` organize route files and framework-attached
  files without changing generated URLs or runtime path matching.
- Route manifests use positional static, dynamic, and catchall specificity. They
  require terminal catchalls. They report both source files and a witness URL
  when canonical runtime shapes conflict.
- `@policy.ts` files are discovered as framework-attached policy files, while
  ordinary `policy.tsx` files remain real URL routes.
- Inherited `@policy.ts` route security is merged root-to-leaf and enforced by
  the HTTP request handler before route handlers run.
- Inherited `@middleware.ts` files run root-to-leaf around HTTP route handlers
  and can short-circuit with a platform `Response`.
- Inherited app-owned `@loading.tsx`, `@not-found.tsx`, and `@error.tsx` files
  render browser fallbacks without framework-owned markup.
- Vite development page requests and production request handling share the same
  route pipeline, including inherited policy and method/security behavior.

## Metadata Scripts And Document Output

Epic: #6

- `defineMetadata(...)`, `meta(...)`, `link(...)`, and `resolveMetadata(...)`
  provide typed app-owned metadata objects with default charset and viewport.
- `structuredData(...)` adds typed JSON-LD entries to metadata and document
  output renders them with escaping and the document nonce when available.
- `defineSitemap(...)`, `renderSitemap(...)`, `defineRobots(...)`, and
  `renderRobots(...)` provide typed standalone SEO output helpers.
- `defineOgImage(...)`, `renderOgImageSvg(...)`, and
  `renderOgImageResponse(...)` provide the first deterministic Open Graph image
  output helper using escaped SVG and cacheable image responses.
- Page route loading resolves inherited layout metadata from root to leaf. It
  then resolves leaf route metadata. The metadata includes titles, structured
  fields, Open Graph defaults, and custom entries.
- `defineScripts(...)`, `script(...)`, and `resolveScripts(...)` provide typed
  static script contributions. Page route loading resolves inherited layout
  scripts root-to-leaf, then leaf route scripts, with dedupe and strategy
  ordering before document rendering.
- `defineLinks(...)`, `preconnect(...)`, `preload(...)`, `modulePreload(...)`,
  and `resolveLinks(...)` provide typed resource hints. Page route loading
  resolves inherited layout links root-to-leaf, then leaf route links, with
  dedupe and deterministic hint ordering before document rendering.
- The framework-owned document renderer can emit resolved metadata, custom meta
  and link tags, resource hints, and static script tags with HTML escaping.
- Vite dev documents for matched page routes feed route/layout metadata,
  resource hints, and static script contributions into the document renderer.

## Error And Not-Found Handling

Epic: #3

- `httpError(...)` creates a typed standard 4xx/5xx failure with deliberate
  RFC 9457 details, extension members, response headers, and an optional cause.
- API failures become `application/problem+json`. Page failures render the
  app-owned error document with the same status, and middleware failures retain
  the existing content negotiation rule.
- Unexpected errors remain redacted in production, while intentional typed
  problem details remain public and `RouteErrorProps` exposes the HTTP status.
- `examples/app-owned-fallbacks` exercises root and nested loading, not-found,
  and error ownership. Its production probe verifies inherited 404 layouts,
  layout-free error documents, typed statuses, problem responses, and redaction.

## Data Cache And Static Generation

Epic: #7

- `query(...)` creates typed reusable cache requests with stable keys, tags,
  scopes, TTLs, and typed return values.
- `createMemoryCache(...)` provides a framework-owned memory cache with
  request-scoped dedupe, shared build/public/private entries, `none` bypass,
  TTL expiry, and key/tag invalidation.
- `tag(...)`, `defineTags(...)`, `serializeCacheKey(...)`, and
  `parseCacheDuration(...)` cover the first cache key/tag behavior tests.
- `createInvalidation(...)` provides a framework-owned server-side invalidation
  surface for cache keys and tags with deterministic deletion counts.
- `CacheStore` and `createCache(...)` publish an async-capable custom backend
  contract. Framework-owned `app:environment:schemaVersion` and scope prefixes
  isolate every backend key and tag while request entries remain local.
- `createMemoryCacheStore(...)` implements that contract, and
  `@demiurgejs/core/data/testing` exports a runner-neutral conformance verifier for
  custom Redis/KV-style adapters. Cache invalidation is async so network stores
  do not need a fake synchronous API.
- `createRequestHandler({ cacheStore })` creates a new facade per request while
  sharing build/public/private entries through the configured backend. Request
  entries stay request-local, none bypasses caching, and omitting the option
  preserves the isolated default.
- `examples/runtime-server-data` exercises public TTL expiry, explicit private
  cache partitioning, request-local dedupe, and uncached reads against a live
  HTTP source. Its production probe verifies those contracts across requests.
- `page({ data, view })` resolves route-level page data with the matched
  request context and a request-scoped framework cache during route loading.
- Route modules can export typed `paths`, and static path collection validates
  dynamic route entries before expanding them into concrete encoded pathnames.
- `createMemoryIdempotencyStore(...)` and `runIdempotentMutation(...)` provide
  the first retry-safe mutation primitive with in-flight dedupe, TTL-based
  replay, and failure retry behavior.
- `action(...)` and `actionInput` provide the first server-side mutation helper
  with JSON/form/text input parsing, existing response-helper returns, and
  optional idempotent response replay.

## Rendering SSR Streaming And RSC

Epic: #8

- `renderPageResponse(...)` renders the page/layout tree, resolved metadata,
  resource hints, and static scripts into the framework-owned document.
- Route `data` is serialized into a non-executable `application/json` bootstrap
  script, escaped against `<`, `>`, `&`, and line separators.
- `hydrateFileRouter(...)` reads and reuses that payload. It does not run route
  `data` again. It gives the resolved match to the browser router. Thus, the
  first client paint does not show a loading fallback.
- The server marks its rendered root with `data-demiurge-hydrate`, and the
  client hydrates only when that marker is present. A static shell without
  server markup is client-rendered instead, because hydrating an empty root
  produces a React hydration mismatch.
- One document renderer serves the HTTP request handler and Vite integration.
  `renderDocument(...)` is in `src/document/render.ts`. An optional `body`
  controls the hydration marker and bootstrap script. Thus, one code path makes
  server-rendered documents and static shells.
- `renderPageDocument(...)` returns the rendered document as a string, and
  `renderPageResponse(...)` returns buffered SSR by default.
- `render: { mode: "streaming" }` uses the React pipeable renderer. It flushes
  the document shell before Suspense boundaries resolve. It applies CSP nonces
  to React completion scripts. It reports errors from the shell commit state.
  It stops when the response body is canceled.
- `examples/streaming-page` exercises the production Node stream with an
  app-owned layout, strict policy, Suspense fallback, and deferred boundary.
- `examples/ssr-page` exercises a server-only `data` loader, metadata cascading
  from layout to leaf, a `path`-based dynamic route, and client navigation
  after hydration.
- Production Vite builds emit a client manifest and a framework-owned SSR
  server entry, which the Node adapter can mount for HTML and API responses.

## Realtime Protocols

Epic: #9

- `sse(...)` provides the first realtime HTTP helper. It serializes server-sent
  events from synchronous iterables, asynchronous iterables, and `ReadableStream`
  sources. Both HTTP handlers apply the required content, cache, and buffering
  headers.
- `jsonl(...)` serializes newline-delimited JSON streams. It accepts synchronous
  iterables, asynchronous iterables, and `ReadableStream` sources. Both HTTP
  handlers apply the required content, cache, and buffering headers.
- `stream(...)` provides generic HTTP streaming for string and byte chunks. It
  accepts synchronous iterables, asynchronous iterables, and `ReadableStream`
  sources. The request and Vite development handlers apply buffering headers.
- `checkWebSocketOrigin(...)` and `enforceWebSocketOrigin(...)` provide the
  first WebSocket security primitive with same-origin checks, exact allowlists,
  malformed-origin rejection, and explicit trusted non-browser missing-origin
  handling.

## Platform Features

Epic: #10

- `defineImages(...)`, `isAllowedImageSource(...)`, and
  `planImageTransform(...)` provide the first image optimization foundation:
  local/remote source validation, explicit remote allowlists, deterministic
  optimizer URLs, responsive variants, and loading/fetch-priority planning.
- `serverTiming(...)` attaches typed `Server-Timing` metrics to route response
  helpers, and HTTP/Vite dev request handlers append the serialized header while
  preserving app-provided timing entries.
- Script dependency audits provide the first GTM trust-boundary diagnostic
  foundation without yet implementing full analytics integration helpers.
- `classifyImageSource(...)` treats only single-slash paths as local. Previously,
  a protocol-relative source could bypass the remote allowlist. The function now
  rejects a source such as `//host/image.png`.

## Adapters And Deployment

Epic: #11

- The production Node adapter converts Node HTTP messages to the web platform
  contract. It serves safe static assets and preserves repeated `Set-Cookie`
  headers. `@demiurgejs/core/node` exports `createNodeServer(...)`.
- Static serving rejects symbolic links in every path component. It verifies
  that the real target stays in the real public root. Supported platforms use
  `O_NOFOLLOW` for the final open operation.
- Static responses expose ETag and Last-Modified validators, return bodyless
  `304` responses when they match, and support single byte ranges with
  `206`/`416` responses.
- Vite production builds emit a client manifest containing the client entry and
  hashed stylesheets. The framework-owned SSR server entry loads route modules
  and creates a request handler that can be mounted by the Node adapter.
- `examples/node-server` exercises the client build, SSR build, API routes,
  dynamic pages, stylesheet assets, and the production Node server together.
- `defineAdapter(...)`, `checkAdapterCapabilities(...)`, and
  `assertAdapterCapabilities(...)` provide the first adapter capability contract
  for nonce injection, streaming, WebSocket, WebTransport, cross-origin
  isolation headers, static output, and shared cache support.
