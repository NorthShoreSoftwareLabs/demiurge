import { useEffect, useState } from "react";
import { page } from "@demiurgejs/core";

function HomePage() {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <main>
      <h1>Observability</h1>
      <p data-hydrated={hydrated} data-testid="hydrated-marker">
        {hydrated ? "Hydrated." : "Not hydrated yet."}
      </p>
      <p>
        <code>GET /api/timings</code> runs a simulated database query and a
        simulated cache lookup, then reports how long each one took in a
        <code>Server-Timing</code> response header.
      </p>
      <p>
        Open this page in a browser, then check the Network panel entry for
        <code>/api/timings</code> and its Timing tab.
      </p>
      <h2>Core Web Vitals</h2>
      <p>
        The root layout mounts <code>&lt;WebVitals /&gt;</code>. The collector
        measures LCP, CLS, INP, FCP, and TTFB with
        <code>PerformanceObserver</code>, then posts one beacon to
        <code>POST /api/vitals</code> when the page hides. No inline snippet and
        no vendor script is involved, so the strict policy needs no
        <code>script-src</code> source for the collector.
      </p>
      <p>
        <code>GET /api/vitals</code> returns the reports the endpoint received.
      </p>
    </main>
  );
}

export const GET = page({
  view: HomePage,
});
