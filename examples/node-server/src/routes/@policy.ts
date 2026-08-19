import { fontSources, security } from "@demiurgejs/core";
import { fonts } from "../fonts";

// The server publishes every declared font, so `fontSources` returns `'self'`
// alone and the policy names no font host.
export const policy = {
  document: security.strict({
    csp: {
      fontSrc: fontSources(fonts),
    },
  }),
};
