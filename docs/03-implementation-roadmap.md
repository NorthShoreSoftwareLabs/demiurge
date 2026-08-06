# Implementation Roadmap

## Phase 1: Route Capabilities

- Replace default component route modules with named capability exports.
- Add helpers:
  - `page(...)`
  - `json(...)`
  - `redirect(...)`
  - `notFound(...)`
- Teach the client router to navigate only page-compatible `GET` routes.
- Keep the existing Vite browser demo working.

Example target:

```ts
export const GET = page(() => <HomePage />);
```

- Rename framework-attached route files to use `@`:
  - `@layout.tsx`
  - `@policy.ts`
  - `@middleware.ts`
  - `@loading.tsx`
  - `@not-found.tsx`
  - `@error.tsx`
- Keep normal files like `policy.ts`, `layout.ts`, and `middleware.ts`
  available as real routes.
- Do not hardcode framework fallback markup. Loading, not-found, and error UI
  must be supplied by the app or inherited framework-attached files.

## Phase 2: Typed Route Context

- Infer path variables from filenames.
- Provide typed handler context:
  - `path`
  - `search`
  - `request`
  - `url`
  - `cookies`
  - `headers`
  - `security`
- Start with local type helpers, then decide whether code generation is needed.

## Phase 3: HTTP Runtime

- Add a tiny development server.
- Resolve route files for real HTTP requests.
- Support `GET`, `POST`, redirects, JSON, and page responses.
- Add preflight handling for route-level CORS.

## Phase 4: Security Presets

- Add a security module that can build headers from typed policy objects.
- Add a production `strict` preset.
- Add nonce generation for dynamic document responses.
- Add tests for invalid CORS/CSP combinations.
- Add CSRF defaults for cookie-authenticated unsafe methods.
- Add rate limit and request size policy.
- Add upload limits.
- Add webhook verification helpers.
- Add Trusted Types report-only and enforce modes.

## Phase 4.5: Metadata And Document Contributions

- Add `defineMetadata`.
- Add metadata cascading from layouts to leaf routes.
- Add title defaults and callback formatters.
- Add structured custom `meta(...)` and `link(...)` helpers.
- Add `defineScripts` and `script(...)`.
- Add managed `<Script />` for render-discovered scripts.
- Add CSP diagnostics for scripts whose origins are not allowed by policy.
- Distinguish static document contributions from render-discovered
  contributions.
- Add structured analytics/GTM integration design.
- Add image and font contribution planning.

## Phase 5: React Server Rendering

- Add SSR page responses.
- Add nonce propagation into the React server renderer.
- Add safe bootstrap data serialization.
- Add streaming SSR and verify every script/style emission has a CSP story.

## Phase 6: RSC

- Add an RSC-capable response helper.
- Keep Flight payloads as data streams where possible.
- Avoid hash-based CSP for dynamic Flight chunks.
- Decide how initial RSC data is delivered under strict CSP.

## Phase 7: Prerendering And Partial Prerendering

- Add static prerender output.
- Add dynamic static route generation.
- Use hash-based CSP for stable static assets.
- Add an adapter contract for per-request nonce injection into prerendered
  shells.
- Fail loudly when a selected render mode cannot satisfy the selected CSP mode.

Dynamic static generation should use the smallest possible API. The route needs
to answer one question at build time:

> Which concrete path variable sets should this dynamic route generate?

Candidate API:

```ts
export const static = page.static({
  paths: async ({ cache }) => {
    const posts = await cache.get(allPostSlugsQuery());
    return posts.map((post) => ({ slug: post.slug }));
  },
});
```

or a route export:

```ts
export const paths = async ({ cache }) => {
  const posts = await cache.get(allPostSlugsQuery());
  return posts.map((post) => ({ slug: post.slug }));
};

export const GET = page({
  render: { mode: "static" },
  view: ({ path }) => <Post slug={path.slug} />,
});
```

Avoid adding a `defineStaticParams(...)` helper unless it materially improves
typing. A plain `paths` export is easier to read and keeps the API smaller.
Use `path` for runtime dynamic path variables and `search` for URL search
parameters; avoid public `params` vocabulary because it is ambiguous with query
parameters.

Static generation rules:

- Non-dynamic static routes can be generated without `paths`.
- Dynamic static routes need either `paths` or a crawl/discovery mechanism.
- `paths` runs at build time.
- The page's `data`, metadata, policy planning, and render run once for each
  returned param set.
- Static generation of paginated archive URLs is just ordinary param generation,
  such as `{ page: "1" }`, `{ page: "2" }`, `{ page: "3" }`.
- Pulling data from a paginated CMS is user data-source logic, not a separate
  framework primitive.

## Phase 8: Realtime

- Add `WS` route capability.
- Add typed peer/session objects.
- Add security controls:
  - origin checks
  - auth hooks
  - subprotocol allowlists
- Consider `WEBTRANSPORT` after deployment support is clearer.

## Phase 9: Adapters

- Node adapter.
- Edge adapter.
- Static adapter.
- Adapter capability checks for:
  - nonce injection
  - streaming
  - WebSocket
  - WebTransport
  - cross-origin isolation headers

## Phase 10: Platform Features

- Add image optimization.
- Add font optimization.
- Add analytics integrations.
- Add OpenTelemetry/instrumentation.
- Add web vitals reporting.
- Add route audit/devtools surface.
