import { security } from "@demiurgejs/core";

export const policy = {
  // This example is public. Demiurge denies a route that inherits no access
  // declaration.
  access: { public: true },
  document: security.strict(),
};
