import type { RoutePolicy } from "demiurge";

export const policy = {
  security: {
    request: {
      allowedMethods: ["GET"],
      maxBodySize: "32kb",
    },
  },
} satisfies RoutePolicy;
