import { defineRoutePolicy, security } from "@demiurgejs/core";

export const policy = defineRoutePolicy({
  // This example is public. Demiurge denies a route that inherits no access
  // declaration.
  access: { public: true },
  document: security.strict(),
  security: {
    request: {
      allowedMethods: ["GET"],
      maxBodySize: "32kb",
    },
  },
});
