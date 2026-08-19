import { analytics } from "@demiurgejs/core";

// The example proxies Plausible through its own origin, which is the
// deployment Plausible documents for applications that would rather not name
// a third-party host. The helper turns the path prefix into `'self'` sources,
// so the same declaration works for a hosted endpoint.
export const plausible = analytics.plausible({
  domain: "analytics-csp.example",
  endpoint: "/stats",
});
