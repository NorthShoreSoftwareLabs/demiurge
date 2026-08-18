import { response } from "@demiurgejs/core";

// A real vendor analytics tag takes time to arrive over the network. The
// delay here stands in for that latency so the browser test can prove the
// dashboard renders and hydrates before this script finishes loading.
const SIMULATED_NETWORK_DELAY_MS = 400;

export const GET = response(async () => {
  await new Promise((resolve) => setTimeout(resolve, SIMULATED_NETWORK_DELAY_MS));

  const body = `
    window.__demiurgeAnalyticsLoadedAt = Date.now();
    var marker = document.createElement("div");
    marker.dataset.testid = "analytics-marker";
    document.body.appendChild(marker);
  `;

  return new Response(body, {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/javascript; charset=utf-8",
    },
  });
});
