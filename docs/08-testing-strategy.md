# Testing Strategy

## Browser conformance

`pnpm test:browser` runs Playwright against a production build of the Node
example. Chromium is a required `pnpm verify` and CI gate. The suite verifies
behavior that DOM emulation and handler-level tests cannot prove: hydration and
SPA navigation without document reloads, browser CSP enforcement, response
security headers, repeated secure-cookie acceptance, browser-generated Fetch
Metadata, and production 404 rendering. Failed CI runs retain a trace and
screenshot for diagnosis.

Demiurge should test like a framework, not like a single app. That means using
several test layers, each protecting a different kind of contract.

## Test Layers

### Unit Tests

Unit tests cover pure framework logic:

- route filename parsing
- route matching
- path variable extraction
- manifest ordering
- layout inheritance
- response helper conversion
- HTTP request handling
- policy merging
- CSP header generation
- cache key/tag behavior
- typed helper output

Current `0.0.1` tests live under `tests/router`:

```txt
tests/router/file-conventions.test.tsx
tests/router/load-route.test.tsx
```

### Type Tests

Type tests should lock in developer experience:

- inferred `path` variables from filenames
- typed `search` schemas
- generated actual URL manifest types
- typed redirects
- typed invalidation paths and tags
- invalid static `paths` exports
- invalid CORS/CSP combinations

Candidate tools:

- `tsc` generated typecheck files
- `expect-type`
- `tsd`

The framework should generate route-specific typecheck files so plain route
exports can stay ergonomic while still being validated.

### Fixture App Tests

Frameworks usually need fixture apps because real behavior depends on bundling,
file discovery, rendering mode, and adapter behavior.

Current fixture:

```txt
examples/basic-blog/
```

Potential future fixture structure:

```txt
examples/
  basic-routes/
  nested-layouts/
  static-blog/
  strict-csp-ssr/
  rsc-streaming/
  websocket/
  image-optimization/
```

Each fixture should be buildable and runnable through the same commands users
will run.

### Browser Tests

Use browser tests for behavior that only exists in the DOM:

- client navigation
- back/forward history
- prefetch
- scroll restoration
- hydration
- script loading strategies
- metadata updates
- CSP enforcement/reporting

Candidate tool: Playwright.

### Adapter Tests

Adapters must declare and prove capabilities:

- streaming
- nonce injection
- WebSocket support
- static output
- image optimization
- cache backend support
- tag invalidation
- request body limits
- Trusted Types/CSP headers

Adapter tests should be shared, so every adapter runs the same behavioral
contract where possible.

### Security Tests

Security tests should include:

- CSP nonce and hash generation
- no accidental `unsafe-inline` in production strict mode
- Trusted Types report-only/enforce headers
- CORS preflight behavior
- CSRF form behavior
- webhook raw-body verification
- request size enforcement
- upload limit enforcement
- WebSocket origin checks

For strict CSP and Trusted Types, browser-level tests are important because
header strings can look correct while runtime behavior still fails.

## Commands

Current commands:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm coverage
pnpm build
pnpm verify
```

`pnpm verify` is the pipeline command. It runs lint, generated route
typechecking, Vitest coverage with 80% thresholds, and the example build.

Future commands:

```sh
pnpm test:types
pnpm test:browser
pnpm test:fixtures
pnpm test:adapters
pnpm audit
```

## 0.0.1 Coverage

MVP `0.0.1` currently verifies:

- `index` routes map to empty segments.
- static, dynamic, and catchall filename segments parse correctly.
- pathnames split predictably.
- path variables decode URL-encoded values.
- `@layout.tsx` files are classified as layouts.
- `@loading.tsx`, `@not-found.tsx`, and `@error.tsx` files are classified as
  app-owned browser fallback files.
- `@middleware.ts` files are classified as framework-attached middleware files.
- `@policy.ts` files are classified as framework-attached policy files.
- normal names like `policy.tsx` remain route files.
- static routes outrank dynamic routes.
- matched routes load inherited layouts root-to-leaf.
- `layout: false` skips inherited layouts.
- HTTP middleware runs root-to-leaf, can short-circuit, and respects route group
  scope.
- Browser routing renders inherited app-owned loading, not-found, and error
  fallbacks.
- route files without a page-compatible `GET` are not page matches.
- HTTP helpers convert to platform `Response` objects.
- HTTP request handler resolves response routes, redirects, HEAD fallback,
  method-not-allowed, and missing routes.
- Vite plugin dev handling serves HTTP capabilities and falls through page or
  unmatched routes to Vite.
- Generated typed URL helpers require path input and produce encoded URL strings.

## Principle

Every major framework feature should have at least one test at the layer where
it can actually fail:

- pure logic: unit test
- TypeScript DX: type test
- bundler/runtime integration: fixture test
- DOM/browser behavior: browser test
- platform support: adapter test
