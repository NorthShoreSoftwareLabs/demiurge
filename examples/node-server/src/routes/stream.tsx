import { lazy, Suspense } from "react";
import { page } from "demiurge";

const DeferredMessage = lazy(async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));

  return {
    default: () => <p data-streamed="">Deferred content reached the client.</p>,
  };
});

function StreamingPage() {
  return (
    <main>
      <h1>Streaming SSR</h1>
      <p>The document shell is available before the deferred component.</p>
      <Suspense fallback={<p data-shell="">Loading deferred content...</p>}>
        <DeferredMessage />
      </Suspense>
    </main>
  );
}

export const GET = page({
  render: { mode: "streaming" },
  view: StreamingPage,
});
