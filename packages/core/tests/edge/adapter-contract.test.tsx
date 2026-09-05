import { Suspense, use } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  defineRoutePolicy,
  page,
  security,
  type RouteModule,
} from "@demiurgejs/core";
import { createEdgeRequestHandler, edgeAdapter } from "@demiurgejs/core/edge";
import { verifyAdapterContract } from "../../src/adapter/testing";

// Each route needs an inherited access declaration, because the request
// pipeline denies a route that declares none. A test that does not examine
// authorization declares public access here.
function routeModule(module: RouteModule) {
  return vi.fn(async () => ({
    ...module,
    policy: { access: { public: true }, ...module.policy },
  }));
}

// A streaming render needs work that is still pending when the shell flushes.
// The probe replaces this promise before every request so each response
// streams the same way.
let pendingValue = Promise.resolve("Deferred ready");

function DeferredValue() {
  return <strong>{use(pendingValue)}</strong>;
}

function StreamingPage() {
  return (
    <main>
      <h1>Streaming shell</h1>
      <Suspense fallback={<p>Loading value</p>}>
        <DeferredValue />
      </Suspense>
    </main>
  );
}

function NoncePage() {
  return <main>Nonce document</main>;
}

function IsolatedPage() {
  return <main>Isolated document</main>;
}

const routes = {
  "./routes/@policy.ts": routeModule({
    policy: defineRoutePolicy({ document: security.strict() }),
  }),
  "./routes/index.tsx": routeModule({
    GET: page({ render: { mode: "streaming" }, view: StreamingPage }),
  }),
  "./routes/nonce.tsx": routeModule({
    GET: page({ view: NoncePage }),
  }),
  "./routes/isolated/@policy.ts": routeModule({
    policy: defineRoutePolicy({ document: security.crossOriginIsolated() }),
  }),
  "./routes/isolated/index.tsx": routeModule({
    GET: page({ view: IsolatedPage }),
  }),
};

const origin = "https://edge.contract.test";

const handler = createEdgeRequestHandler({
  cacheStore: "unavailable",
  rateLimitStore: "unavailable",
  routes,
  ssr: { clientEntry: "/assets/client.js" },
});

describe("edge adapter contract", () => {
  it("proves every capability the edge adapter declares", async () => {
    await expect(
      verifyAdapterContract(edgeAdapter, {
        crossOriginIsolationHeaders: () =>
          handler(new Request(`${origin}/isolated`)),
        nonceInjection: () => handler(new Request(`${origin}/nonce`)),
        streaming: async () => {
          pendingValue = new Promise((resolveValue) => {
            setTimeout(() => resolveValue("Deferred ready"), 20);
          });

          return await handler(new Request(`${origin}/`));
        },
      }),
    ).resolves.toBeUndefined();
  });

  it("declares the capabilities the contract proved", () => {
    expect(edgeAdapter).toEqual({
      capabilities: {
        backgroundLifetime: false,
        crossOriginIsolationHeaders: true,
        nonceInjection: true,
        sharedCache: false,
        staticOutput: false,
        streaming: true,
        webSocket: false,
        webTransport: false,
      },
      name: "edge",
    });
  });
});
