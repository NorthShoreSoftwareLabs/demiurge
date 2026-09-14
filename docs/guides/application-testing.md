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

The helper returns the production `Response`. Your test runner owns assertions,
mocks, and fixtures. A build or process test verifies deployment output.

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
