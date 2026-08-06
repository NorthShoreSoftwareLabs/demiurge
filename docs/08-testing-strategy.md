# Testing Strategy

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
- policy merging
- CSP header generation
- cache key/tag behavior
- typed helper output

Current `0.0.1` tests live next to the router:

```txt
src/mini-framework/router.test.tsx
```

### Type Tests

Type tests should lock in developer experience:

- inferred `path` variables from filenames
- typed `search` schemas
- typed route manifest functions
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

Potential structure:

```txt
fixtures/
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
npm run typecheck
npm test
npm run build
```

Future commands:

```sh
npm run test:types
npm run test:browser
npm run test:fixtures
npm run test:adapters
npm run audit
```

## 0.0.1 Coverage

MVP `0.0.1` currently verifies:

- `index` routes map to empty segments.
- static, dynamic, and catchall filename segments parse correctly.
- pathnames split predictably.
- path variables decode URL-encoded values.
- `@layout.tsx` files are classified as layouts.
- normal names like `policy.tsx` remain route files.
- static routes outrank dynamic routes.
- matched routes load inherited layouts root-to-leaf.
- `layout: false` skips inherited layouts.
- route files without a page-compatible `GET` are not page matches.

## Principle

Every major framework feature should have at least one test at the layer where
it can actually fail:

- pure logic: unit test
- TypeScript DX: type test
- bundler/runtime integration: fixture test
- DOM/browser behavior: browser test
- platform support: adapter test
