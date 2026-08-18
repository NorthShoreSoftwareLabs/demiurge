import { page } from "@demiurgejs/core";

export const GET = page({
  view: () => (
    <main>
      <h1>Observability</h1>
      <p>
        <code>GET /api/timings</code> runs a simulated database query and a
        simulated cache lookup, then reports how long each one took in a
        <code>Server-Timing</code> response header.
      </p>
      <p>
        Open this page in a browser, then check the Network panel entry for
        <code>/api/timings</code> and its Timing tab.
      </p>
    </main>
  ),
});
