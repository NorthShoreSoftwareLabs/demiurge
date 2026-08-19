import { analytics, defineRoutePolicy, mergeRoutePolicies, security } from "@demiurgejs/core";
import { plausible } from "../analytics";

// `analytics.policy(...)` contributes the CSP sources the integration needs.
// Removing it makes startup fail with a diagnostic that names the missing
// directive, rather than leaving a blocked script in the rendered page.
export const policy = defineRoutePolicy(
  mergeRoutePolicies(
    { document: security.strict() },
    analytics.policy(plausible),
  ),
);
