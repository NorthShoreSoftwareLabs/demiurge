import { defineRoutePolicy, security } from "@demiurgejs/core";

export const policy = defineRoutePolicy({
  document: security.strict(),
  security: {
    request: {
      allowedMethods: ["GET"],
      maxBodySize: "32kb",
    },
  },
});
