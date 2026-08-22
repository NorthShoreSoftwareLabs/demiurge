import {
  defineInstrumentation,
  readWebVitalsBeacon,
  response,
  type WebVitalSignal,
} from "@demiurgejs/core";

// A real deployment forwards each signal to a metrics backend. This example
// keeps the last reports in memory, so a browser test can read them back.
const reportLimit = 50;
const received: WebVitalSignal[] = [];

const instrumentation = defineInstrumentation({
  webVitals: (signal) => {
    received.push(signal);

    if (received.length > reportLimit) {
      received.splice(0, received.length - reportLimit);
    }
  },
});

// The browser posts through `navigator.sendBeacon`, which sends no CSRF token
// and no custom header. The route turns the CSRF check off and limits the body
// size instead. `readWebVitalsBeacon` validates every field before the handler
// forwards a report.
export const POST = response(async ({ request }) => {
  const beacon = await readWebVitalsBeacon(request);

  if (!beacon.ok) {
    return Response.json({ reason: beacon.reason }, {
      headers: { "cache-control": "no-store" },
      status: 400,
    });
  }

  for (const metric of beacon.metrics) {
    await instrumentation.reportWebVitals(metric);
  }

  return new Response(null, {
    headers: { "cache-control": "no-store" },
    status: 202,
  });
}, {
  security: {
    csrf: false,
    rateLimit: { key: "ip", limit: 600, window: "1m" },
    request: { maxBodySize: "8kb" },
  },
});

export const GET = response(() =>
  Response.json({ metrics: received }, {
    headers: { "cache-control": "no-store" },
  })
);
