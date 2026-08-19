import { fontSources, security } from "@demiurgejs/core";
import { fonts } from "../fonts";
import { siteStructuredDataHash } from "../site-structured-data";

// Every font is self-hosted, so `fontSources` returns `'self'` alone and the
// policy names no font host.
export const policy = {
  document: security.static({
    csp: {
      fontSrc: fontSources(fonts),
      scriptSrc: ["'self'", siteStructuredDataHash],
    },
  }),
};
