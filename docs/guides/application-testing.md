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
