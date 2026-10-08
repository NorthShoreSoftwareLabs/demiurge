import { errorMonitor, once, type EventEmitter } from "node:events";
import { Suspense, use } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createRequestHandler,
  defineRoutePolicy,
  defineRuntimeInstrumentation,
  page,
  security,
  type RouteModule,
} from "@demiurgejs/core";
import {
  createNodeServer,
  nodeAdapter,
  renderNodePageResponse,
  type NodeServer,
} from "@demiurgejs/core/node";
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

let server: NodeServer;
let origin: string;
const lifecycleSpans: Array<{
  attributes: Record<string, unknown>;
  ends: number;
  operation: string;
}> = [];
const runtimeInstrumentation = defineRuntimeInstrumentation({
  startSpan(options) {
    const span = {
      attributes: { ...options.attributes },
      ends: 0,
      operation: options.operation,
    };
    lifecycleSpans.push(span);
    return {
      context: {},
      end() {
        span.ends += 1;
      },
      setAttribute(name, value) {
        span.attributes[name] = value;
      },
      setStatus() {},
    };
  },
});

beforeAll(async () => {
  server = createNodeServer({
    allowedHosts: ["127.0.0.1"],
    handler: createRequestHandler({
      renderPage: renderNodePageResponse,
      routes,
      ssr: { clientEntry: "/assets/client.js" },
    }),
    runtimeInstrumentation,
    shutdown: { gracePeriod: 1_000, signals: [] },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  await server.shutdown();
  expect(lifecycleSpans.map((span) => span.operation)).toEqual([
    "demiurge.adapter.start",
    "demiurge.adapter.shutdown",
  ]);
  expect(lifecycleSpans.map((span) => span.attributes["demiurge.operation.outcome"]))
    .toEqual(["success", "success"]);
  expect(lifecycleSpans.map((span) => span.ends)).toEqual([1, 1]);
  const errorEvents: EventEmitter = server;
  errorEvents.emit(errorMonitor, new Error("late observed error"));
  expect(lifecycleSpans[0]?.ends).toBe(1);
});

function backgroundHost() {
  const host = createNodeServer({
    allowedHosts: ["127.0.0.1"],
    handler: async () => new Response("ok"),
    shutdown: {
      gracePeriod: 1_000,
      onBackgroundError: () => {},
      signals: [],
    },
  });

  return {
    shutdown: () => host.shutdown(),
    waitUntil: (promise: Promise<unknown>) => host.waitUntil(promise),
  };
}

describe("Node adapter contract", () => {
  it("ends a failed startup span once and preserves the listener error", async () => {
    const occupied = createNodeServer({
      allowedHosts: ["127.0.0.1"],
      handler: async () => new Response("ok"),
    });
    occupied.listen(0, "127.0.0.1");
    await once(occupied, "listening");
    const failureSpans: Array<{
      attributes: Record<string, unknown>;
      ends: number;
      operation: string;
    }> = [];
    const failing = createNodeServer({
      allowedHosts: ["127.0.0.1"],
      handler: async () => new Response("ok"),
      runtimeInstrumentation: defineRuntimeInstrumentation({
        startSpan(options) {
          const span = {
            attributes: { ...options.attributes },
            ends: 0,
            operation: options.operation,
          };
          failureSpans.push(span);
          return {
            context: {},
            end() {
              span.ends += 1;
            },
            setAttribute(name, value) {
              span.attributes[name] = value;
            },
            setStatus() {},
          };
        },
      }),
    });
    const address = occupied.address();
    const port = typeof address === "object" && address ? address.port : 0;

    failing.listen(port, "127.0.0.1");
    await once(failing, "error");
    expect(failureSpans.map((span) => span.operation)).toEqual([
      "demiurge.adapter.start",
    ]);
    expect(failureSpans[0]?.attributes["demiurge.operation.outcome"]).toBe("error");
    expect(failureSpans[0]?.ends).toBe(1);
    const errorEvents: EventEmitter = failing;
    expect(errorEvents.listeners(errorMonitor)).toHaveLength(0);

    await failing.shutdown();
    await occupied.shutdown();
  });

  it("proves every capability the Node adapter declares", async () => {
    await expect(
      verifyAdapterContract(nodeAdapter, {
        backgroundLifetime: backgroundHost,
        crossOriginIsolationHeaders: () => fetch(`${origin}/isolated`),
        nonceInjection: () => fetch(`${origin}/nonce`),
        streaming: async () => {
          pendingValue = new Promise((resolveValue) => {
            setTimeout(() => resolveValue("Deferred ready"), 20);
          });

          return await fetch(`${origin}/`);
        },
      }),
    ).resolves.toBeUndefined();
  });

  it("declares the capabilities the contract proved", () => {
    expect(nodeAdapter).toEqual({
      capabilities: {
        backgroundLifetime: true,
        crossOriginIsolationHeaders: true,
        nonceInjection: true,
        requestTimeoutEnforcement: true,
        responseBodyCompletion: true,
        sharedCache: false,
        staticOutput: false,
        streaming: true,
        webSocket: false,
        webTransport: false,
      },
      name: "node",
    });
  });
});
