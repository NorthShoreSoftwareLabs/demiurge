import { defineRoutePolicy } from "@demiurgejs/core";

export const policy = defineRoutePolicy({
  document: {
    csp: {
      connectSrc: { replace: ["'self'"] },
    },
    headers: {
      referrerPolicy: "no-referrer",
    },
  },
});
