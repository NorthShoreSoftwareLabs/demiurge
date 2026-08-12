import { defineRoutePolicy } from "@demiurge/core";

export const policy = defineRoutePolicy({
  security: {
    request: {
      allowedMethods: ["GET"],
      maxBodySize: "32kb",
    },
  },
});
