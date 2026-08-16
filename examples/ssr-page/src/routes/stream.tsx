import { lazy, Suspense } from "react";
import { page, Script, security } from "@demiurgejs/core";

const DeferredPanel = lazy(async () => ({
  default: () => (
    <>
      <p data-streamed="">The streamed content is ready.</p>
      <Script src="/assets/streamed-conditional.js" />
    </>
  ),
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

export const policy = {
  document: security.static({
    csp: {
      scriptSrc: { replace: ["'self'"] },
      styleSrc: { replace: ["'self'"] },
    },
  }),
};
