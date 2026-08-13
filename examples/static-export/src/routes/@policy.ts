import { security } from "@demiurgejs/core";
import { siteStructuredDataHash } from "../site-structured-data";

export const policy = {
  document: security.static({
    csp: {
      scriptSrc: ["'self'", siteStructuredDataHash],
    },
  }),
};
