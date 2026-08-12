import { defineRoutePolicy, security } from "@demiurge/core";

export const policy = defineRoutePolicy({
  document: security.strict(),
});
