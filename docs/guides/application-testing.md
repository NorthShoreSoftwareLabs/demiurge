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
