import { lazy, Suspense } from "react";
import { page, Script } from "@demiurgejs/core";

// The delay makes the lazy import resolve after the document head flushes.
// The test then exercises the in-place streamed script path, not the
// hoisted-into-head path. The delay must stay longer than the development
// document transform, or the script hoists into the head instead.
const DeferredPanel = lazy(async () => {
  await new Promise((resolve) => setTimeout(resolve, 250));

  return {
    default: () => (
      <>
        <p data-streamed="">The streamed content is ready.</p>
        <Script src="/assets/streamed-conditional.js" />
      </>
    ),
  };
});

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
