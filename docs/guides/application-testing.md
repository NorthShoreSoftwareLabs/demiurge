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
