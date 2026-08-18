import { sse } from "@demiurgejs/core";

const EVENTS_PER_CONNECTION = 4;
const TICK_INTERVAL_MS = 150;
const RECONNECT_DELAY_MS = 200;

// The stream ends after a handful of ticks so the browser's EventSource
// reconnects on its own. `id` lets a resumed connection pick up its counter
// where the last one stopped instead of restarting at zero.
export const GET = sse(async function* ({ request }) {
  const lastEventId = Number(request.headers.get("last-event-id") ?? 0);
  let tick = Number.isFinite(lastEventId) ? lastEventId : 0;

  for (let sent = 0; sent < EVENTS_PER_CONNECTION; sent += 1) {
    await new Promise((resolve) => setTimeout(resolve, TICK_INTERVAL_MS));

    if (request.signal.aborted) {
      return;
    }

    tick += 1;

    yield {
      data: { tick },
      event: "tick",
      id: String(tick),
      retry: RECONNECT_DELAY_MS,
    };
  }
});
