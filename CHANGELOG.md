# Changelog

What has actually shipped, by area. This file is the record of completed work;
open work lives in GitHub issues, and `tasks/` holds the specs.

Nothing here is released yet. The package is `0.0.1` and unpublished, so these
are development milestones rather than versioned releases.

## Pipeline Quality Gates

Epic: #1

- The library lives in `packages/demiurge` as an npm workspace, and the examples
  depend on it by name so resolution runs through `node_modules` and the
  package `exports` map instead of a path alias.
- The package builds to `dist` with emitted declarations, and `react`,
  `react-dom`, and `vite` are peer dependencies rather than bundled runtime
  dependencies.
- `npm run test:pack` packs the tarball, installs it into a scratch app, and
  imports every declared entry point. It is the only gate that exercises
  packaging the way a consumer experiences it.

## Security Policy And CSP

Epic: #4

- Public `security` helpers for strict, API, and cross-origin-isolated presets.
- `defineSecurityPolicy(...)` and `mergeSecurityPolicies(...)` for app/layout/
  route policy cascade.
- `createSecurityHeaders(...)` for deterministic CSP, security header, HSTS,
  and Trusted Types header rendering.
- Strict CSP nonce substitution fails closed when the nonce is missing.
- Static CSP preset and `cspHash(...)` helper for build-time hash-based CSP.
- Helper-attached CORS policy, actual response CORS headers, generated
  preflight responses, and wildcard-plus-credentials validation.
- Helper-attached request body size limits enforced before route handlers read
  oversized declared bodies.
- Helper-attached request allowed-method policy enforced before route handlers
  run.
- Helper-attached fixed-window rate limits with pluggable server storage and
  dev in-memory storage.
- Default double-submit CSRF protection for cookie-authenticated unsafe methods,
  configurable cookie/header token names, and explicit route-policy exemptions.
- Generic HMAC webhook helper that preserves raw bodies and rejects missing or
  invalid signatures before the app handler runs.
- `createSecurityAudit(...)` for rendered header snapshots, effective route
  policy inspection, and structured security findings.
- `createSecurityAudit(...)` reports document static scripts that are missing
  required CSP nonces or are not allowed by the effective `script-src` policy.
- `defineEnvSchema(...)`, `env.*(...)`, and `validateEnv(...)` validate runtime
  configuration and secrets before request handling starts.
- `auditScriptDependencies(...)` and opt-in `createSecurityAudit(...)`
  dependency checks warn about undeclared third-party script purposes, missing
  integrity when required, early third-party execution, and Google Tag Manager's
  wide runtime trust boundary.
- `createSecurityReportHandler(...)` provides a POST-only CSP/Reporting API
  report ingestion helper with optional body-size enforcement and per-report
  callbacks.
- `validateUploads(...)` validates parsed `FormData` files against required
  fields, per-file size limits, aggregate size limits, and MIME/type allowlists.

## Route Policies And Middleware

Epic: #5

- Route groups such as `(admin)` organize route files and framework-attached
  files without changing generated URLs or runtime path matching.
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
- Page route loading resolves inherited layout metadata root-to-leaf, then leaf
  route metadata, including title defaults, title formatters, structured fields,
  Open Graph defaults, and custom metadata entries.
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
- API failures become `application/problem+json`; page failures render the
  app-owned error document with the same status, and middleware failures retain
  the existing content negotiation rule.
- Unexpected errors remain redacted in production, while intentional typed
  problem details remain public and `RouteErrorProps` exposes the HTTP status.

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
  `demiurge/data/testing` exports a runner-neutral conformance verifier for
  custom Redis/KV-style adapters. Cache invalidation is async so network stores
  do not need a fake synchronous API.
- `createRequestHandler({ cacheStore })` creates a new facade per request while
  sharing build/public/private entries through the configured backend. Request
  entries stay request-local, none bypasses caching, and omitting the option
  preserves the isolated default.
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
- `hydrateFileRouter(...)` reads that payload, reuses it instead of re-running
  route `data`, and seeds the browser router with the resolved match so the
  first client paint does not flash a loading fallback.
- The server marks its rendered root with `data-demiurge-hydrate`, and the
  client hydrates only when that marker is present. A static shell without
  server markup is client-rendered instead, because hydrating an empty root
  produces a React hydration mismatch.
- One document renderer, `renderDocument(...)` in `src/document/render.ts`,
  now serves both the HTTP request handler and the Vite integration. It takes
  an optional `body` and emits the hydration marker plus bootstrap script only
  when one is present, so the same code path produces both server-rendered
  documents and static shells.
- `renderPageDocument(...)` returns the rendered document as a string, and
  `renderPageResponse(...)` returns buffered SSR by default.
- `render: { mode: "streaming" }` uses React's pipeable renderer, flushes the
  document shell before Suspense boundaries resolve, propagates strict CSP
  nonces to React completion scripts, reports errors according to shell commit
  state, and aborts when the response body is cancelled.
- `examples/streaming-page` exercises the production Node stream with an
  app-owned layout, strict policy, Suspense fallback, and deferred boundary.
- `examples/ssr-page` exercises a server-only `data` loader, metadata cascading
  from layout to leaf, a `path`-based dynamic route, and client navigation
  after hydration.
- Production Vite builds emit a client manifest and a framework-owned SSR
  server entry, which the Node adapter can mount for HTML and API responses.

## Realtime Protocols

Epic: #9

- `sse(...)` provides the first realtime HTTP helper. It serializes string and
  structured server-sent events from sync iterables, async iterables, and
  `ReadableStream` sources with `text/event-stream`, no-cache, and buffering
  control headers through both the request handler and Vite dev handler.
- `jsonl(...)` serializes newline-delimited JSON streams from sync iterables,
  async iterables, and `ReadableStream` sources with `application/x-ndjson`,
  no-cache, and buffering control headers through both the request handler and
  Vite dev handler.
- `stream(...)` provides generic HTTP streaming for string and byte chunks from
  sync iterables, async iterables, and `ReadableStream` sources with buffering
  control headers through both the request handler and Vite dev handler.
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
- `classifyImageSource(...)` treats only single-slash paths as local. A
  protocol-relative source such as `//host/image.png` previously matched the
  local branch and skipped the remote allowlist entirely, so it is now rejected
  outright rather than resolved against the page origin.

## Adapters And Deployment

Epic: #11

- The production Node adapter converts Node HTTP requests and responses to the
  web platform contract, serves safe static assets, preserves repeated
  `Set-Cookie` headers, and exposes `createNodeServer(...)` from `demiurge/node`.
- Vite production builds emit a client manifest containing the client entry and
  hashed stylesheets. The framework-owned SSR server entry loads route modules
  and creates a request handler that can be mounted by the Node adapter.
- `examples/node-server` exercises the client build, SSR build, API routes,
  dynamic pages, stylesheet assets, and the production Node server together.
- `defineAdapter(...)`, `checkAdapterCapabilities(...)`, and
  `assertAdapterCapabilities(...)` provide the first adapter capability contract
  for nonce injection, streaming, WebSocket, WebTransport, cross-origin
  isolation headers, static output, and shared cache support.
