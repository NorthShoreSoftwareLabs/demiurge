import { fontSources, security } from "@demiurgejs/core";
import { fonts } from "../fonts";

// The server publishes every declared font, so `fontSources` returns `'self'`
// alone and the policy names no font host.
export const policy = {
  // This example is public. Demiurge denies a route that inherits no access
  // declaration.
  access: { public: true },
  document: security.strict({
    csp: {
      fontSrc: fontSources(fonts),
    },
  }),
};
