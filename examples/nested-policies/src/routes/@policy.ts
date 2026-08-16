import { defineRoutePolicy, security } from "@demiurgejs/core";

export const policy = defineRoutePolicy({
  document: security.strict({
    csp: {
      connectSrc: ["https://api.example.com"],
    },
  }),
});
