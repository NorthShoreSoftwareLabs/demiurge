import { lazy, Suspense } from "react";
import { Link, page } from "@demiurgejs/core";

const DeferredRuntime = lazy(async () => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  return { default: () => <p data-streamed="">The server stream completed.</p> };
});

export const GET = page({
  render: { mode: "streaming" },
  view: Home,
});

function Home() {
  return (
    <main>
      <p className="eyebrow">Node function artifact</p>
      <h1>Demiurge runs on Vercel</h1>
      <p>The application uses the same route and document pipeline as other hosts.</p>
      <Suspense fallback={<p data-fallback="">The server stream is open.</p>}>
        <DeferredRuntime />
      </Suspense>
      <p><Link to="/about">Test client navigation</Link></p>
    </main>
  );
}
