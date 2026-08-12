import { defineRoutePolicy } from "@demiurgejs/core";

export const policy = defineRoutePolicy({
  security: {
    request: {
      allowedMethods: ["GET"],
      maxBodySize: "32kb",
    },
  },
});
