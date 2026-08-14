import { lazy, Suspense } from "react";
import { page } from "@demiurgejs/core";

const DeferredPanel = lazy(async () => ({
  default: () => <p data-streamed="">The streamed content is ready.</p>,
}));

function StreamingPage() {
  return (
    <main>
      <h1>Development streaming</h1>
      <Suspense fallback={<p>Loading streamed content.</p>}>
        <DeferredPanel />
      </Suspense>
    </main>
  );
}

export const GET = page({
  render: { mode: "streaming" },
  view: StreamingPage,
});
