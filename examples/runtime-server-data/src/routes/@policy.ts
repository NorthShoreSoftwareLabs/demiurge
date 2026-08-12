import { defineRoutePolicy, security } from "@demiurge-js/core";

export const policy = defineRoutePolicy({
  document: security.strict(),
});
