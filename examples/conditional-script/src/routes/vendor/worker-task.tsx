import { response } from "@demiurgejs/core";

// The worker strategy hands this source to the Worker constructor, so the code
// runs on its own thread. The blocking loop below would freeze the page if the
// framework had loaded it as an ordinary script.
export const GET = response(() => {
  const body = `
    self.addEventListener("message", function (event) {
      var startedAt = Date.now();

      while (Date.now() - startedAt < event.data.busyMs) {
        // Hold this thread, and only this thread.
      }

      self.postMessage({ finishedAt: Date.now(), startedAt: startedAt });
    });
  `;

  return new Response(body, {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/javascript; charset=utf-8",
    },
  });
});
