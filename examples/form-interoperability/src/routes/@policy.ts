import { defineRoutePolicy, security } from "@demiurgejs/core";

export const policy = defineRoutePolicy({
  // This example is public. Demiurge denies a route that inherits no access
  // declaration.
  access: { public: true },
  // The example server speaks http on localhost. `upgrade-insecure-requests`
  // would send the client fetch to https, which that server does not answer.
  // A deployment behind TLS keeps the directive.
  document: security.strict({ csp: { upgradeInsecureRequests: false } }),
});
