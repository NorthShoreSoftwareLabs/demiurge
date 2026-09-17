# Application Testing

`@demiurgejs/core/testing` runs a request through the production route
pipeline. It has no test-runner dependency.

```ts
import { createApplicationTest } from "@demiurgejs/core/testing";

const application = createApplicationTest({ routes });
const response = await application.request("/reports");
```

`request` accepts a `Request`, pathname, or URL. A pathname uses
`https://demiurge.test` as its origin.

Pass a handler when the application composes the handler before the test:

```ts
const application = createApplicationTest(handler);
```

The helper returns the production `Response`. Your test runner owns assertions
and mocks. A build or process test verifies deployment output.

## Deterministic fixtures

Use `createTestRequest(...)` when a test needs a standard `Request` with the
application test origin. It returns the browser `Request` type. Pass a normal
`RequestInit` object to set a method, body, or headers.

Use `createTestClock(...)` where a store or manager accepts `now`. The clock
starts at `0` unless the test gives an initial time. Call `set(...)` or
`advance(...)` to control time.

```ts
import {
  createTestClock,
  createTestRequest,
} from "@demiurgejs/core/testing";

const clock = createTestClock(1_000);
const request = createTestRequest("/reports", { method: "POST" });
```

Use `createMemoryCacheStore`, `createMemoryIdempotencyStore`, and
`createMemorySessionStore` from `@demiurgejs/core` for local tests. The stores
do not share entries across processes or replicas. Give the cache and
idempotency stores `now: clock.now` when a test controls expiration. Give a
session manager `now: clock.now` when a test controls session expiration.

Use the document and security assertions for framework-owned output:

```ts
import { assertDocument, assertSecurity } from "@demiurgejs/core/testing";

await assertDocument(response, { title: "Reports" });
await assertSecurity(response, { nonce: true });
```

`assertSecurity` verifies that a document nonce appears in the CSP header. It
also requires a private or no-store cache policy for a nonce-backed document.

## Static output tests

Use `@demiurgejs/core/static/testing` to inspect a generated artifact. Pass a
temporary directory that the test creates and removes. The utility does not
remove the directory.

```ts
import {
  createStaticOutputTest,
  verifyStaticOutput,
} from "@demiurgejs/core/static/testing";

const output = await createStaticOutputTest({ outDir, routes });
expect(output.entry("/reports/acme")?.status).toBe(200);
await expect(output.readFile("reports/acme/index.html")).resolves.toBeDefined();
await verifyStaticOutput(outDir, output.manifest);
```

`entry("*")` inspects the application fallback. `headers(pathname)` reads the
declared response headers. `files()` lists every file in the output directory.
Use `verifyStaticProvider` to run a provider translator and its assertions
against the same static manifest.
