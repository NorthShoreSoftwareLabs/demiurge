import { defineRoutePolicy } from "demiurge";

export const policy = defineRoutePolicy({
  security: {
    request: {
      allowedMethods: ["GET"],
      maxBodySize: "32kb",
    },
  },
});
