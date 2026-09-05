import { fontSources, security } from "@demiurgejs/core";
import { fonts } from "../fonts";
import { siteStructuredDataHash } from "../site-structured-data";

// Every font is self-hosted, so `fontSources` returns `'self'` alone and the
// policy names no font host.
export const policy = {
  // This example is public. Demiurge denies a route that inherits no access
  // declaration.
  access: { public: true },
  document: security.static({
    csp: {
      fontSrc: fontSources(fonts),
      scriptSrc: ["'self'", siteStructuredDataHash],
    },
  }),
};
