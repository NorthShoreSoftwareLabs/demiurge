import {
  defineRoutePolicy,
  mergeRoutePolicies,
  security,
  webVitalsPolicy,
} from "@demiurgejs/core";
import { vitals } from "../web-vitals";

// The collector runs inside the application bundle and uses PerformanceObserver
// only. It adds no script-src source. It posts one beacon, so the policy needs
// connect-src for the endpoint alone.
export const policy = defineRoutePolicy(
  mergeRoutePolicies(
    { document: security.strict() },
    webVitalsPolicy(vitals),
  ),
);
