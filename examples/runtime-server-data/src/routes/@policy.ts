import { defineRoutePolicy, security } from "demiurge";

export const policy = defineRoutePolicy({
  document: security.strict(),
});
