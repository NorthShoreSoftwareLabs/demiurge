import { lazy, Suspense } from "react";
import { defineMetadata, page } from "demiurge";

const DeferredPanel = lazy(async () => {
  await new Promise((resolve) => setTimeout(resolve, 250));

  return {
    default: () => (
      <section data-streamed="">
        <h2>Deferred panel</h2>
        <p>This boundary arrived after the document shell.</p>
      </section>
    ),
  };
});

function StreamingHome() {
  return (
    <main>
      <h1>Streaming SSR</h1>
      <p data-shell="">This heading and fallback flush with the shell.</p>
      <Suspense fallback={<p data-fallback="">Loading deferred panel...</p>}>
        <DeferredPanel />
      </Suspense>
    </main>
  );
}

export const metadata = defineMetadata({
  description: "A production Demiurge streaming SSR example.",
  title: "Streaming SSR",
});

export const GET = page({
  render: { mode: "streaming" },
  view: StreamingHome,
});
