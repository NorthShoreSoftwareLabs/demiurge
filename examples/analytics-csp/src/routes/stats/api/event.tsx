import { response } from "@demiurgejs/core";

// A proxied Plausible deployment forwards this path to the vendor API. The
// example answers it locally, so a browser test can prove the beacon survives
// the effective connect-src directive.
export const POST = response(async ({ request }) => {
  await request.text();

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
