import { defineWebVitals } from "@demiurgejs/core";

// The application owns the endpoint, so the framework reports no measurement
// to a third party. A same-origin path needs `'self'` in connect-src, which
// `webVitalsPolicy(...)` contributes to the route policy.
export const vitals = defineWebVitals({ endpoint: "/api/vitals" });
