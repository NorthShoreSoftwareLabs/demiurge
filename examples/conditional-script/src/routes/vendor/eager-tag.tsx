import { response } from "@demiurgejs/core";

// The afterInteractive companion to the idle tag. The browser fetches this one
// while it parses the document, so it runs before hydration starts. It then
// keeps the main thread busy for a while, which is what an idle script has to
// wait out.
const BUSY_TASKS = 12;
const BUSY_TASK_MS = 100;

export const GET = response(() => {
  const body = `
    window.__demiurgeEagerTagLoadedAt = Date.now();

    var remaining = ${BUSY_TASKS};

    function busy() {
      var startedAt = Date.now();

      while (Date.now() - startedAt < ${BUSY_TASK_MS}) {
        // Hold the main thread for one task.
      }

      remaining -= 1;

      if (remaining > 0) {
        setTimeout(busy, 0);
        return;
      }

      window.__demiurgeBusyEndedAt = Date.now();
    }

    setTimeout(busy, 0);
  `;

  return new Response(body, {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/javascript; charset=utf-8",
    },
  });
});
