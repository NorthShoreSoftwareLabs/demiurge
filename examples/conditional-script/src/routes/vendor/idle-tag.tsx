import { response } from "@demiurgejs/core";

// The idle strategy waits for the browser to report an idle period. This tag
// records when it ran, so the page can compare that moment against the moment
// the main thread stopped being busy.
export const GET = response(() => {
  const body = `window.__demiurgeIdleTagLoadedAt = Date.now();`;

  return new Response(body, {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/javascript; charset=utf-8",
    },
  });
});
