import { defineRoutePolicy } from "@demiurgejs/core";

export const policy = defineRoutePolicy({
  // Demiurge denies a route that inherits no access declaration. This
  // application is public, so the root policy states that intent. Replace this
  // declaration with access: { authorize } for a subtree that needs a check.
  access: { public: true },
  security: {
    request: {
      allowedMethods: ["GET"],
      maxBodySize: "32kb",
    },
  },
});
