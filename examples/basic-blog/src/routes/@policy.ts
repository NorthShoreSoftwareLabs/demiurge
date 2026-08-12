import { defineRoutePolicy } from "@demiurge-js/core";

export const policy = defineRoutePolicy({
  security: {
    request: {
      allowedMethods: ["GET"],
      maxBodySize: "32kb",
    },
  },
});
