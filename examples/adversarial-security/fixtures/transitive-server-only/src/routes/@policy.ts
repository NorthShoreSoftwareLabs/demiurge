import { defineRoutePolicy, security } from "@demiurgejs/core";

export const policy = defineRoutePolicy({
  access: { public: true },
  document: security.strict(),
});
