import { defineRoutePolicy, security } from "@demiurgejs/core";

// A worker script is governed by worker-src, and the strict preset does not
// set that directive. Without it the browser falls back to script-src, which
// carries strict-dynamic and refuses a worker URL.
export const policy = defineRoutePolicy({
  // This example is public. Demiurge denies a route that inherits no access
  // declaration.
  access: { public: true },
  document: security.strict({ csp: { workerSrc: ["'self'"] } }),
});
