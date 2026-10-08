import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  createRequestHandler,
  defineRuntimeInstrumentation,
  defineMiddleware,
  json,
  mutation,
  MUTATION_REQUEST_HEADER,
  MUTATION_REQUEST_VALUE,
  page,
  response as rawResponse,
  type RuntimeSpanContext,
  type RuntimeSpanKind,
  type RuntimeSpanOperation,
  type RuntimeSpanStatus,
  type RuntimeSpanStartOptions,
  type RouteModule,
  type RouteProps,
} from "@demiurgejs/core";

type RecordedSpan = {
  attributes: Record<string, unknown>;
  context: RuntimeSpanContext;
  ended: boolean;
  events: Array<{ attributes?: Record<string, unknown>; name: string }>;
  kind: RuntimeSpanKind;
  name: string;
  operation: RuntimeSpanOperation;
  parent?: RuntimeSpanContext;
  status?: RuntimeSpanStatus;
};

function routeModule(module: RouteModule) {
  return vi.fn(async () => ({
    ...module,
    policy: { access: { public: true }, ...module.policy },
  }));
}

function View({ data }: RouteProps<string, { message: string }>) {
  return <main>{data.message}</main>;
}

function createRecorder() {
  const spans: RecordedSpan[] = [];
  let nextId = 0;

  return {
    runtimeInstrumentation: defineRuntimeInstrumentation({
      startSpan(options: RuntimeSpanStartOptions) {
        const span: RecordedSpan = {
          attributes: { ...options.attributes },
          context: { spanId: `span-${++nextId}` },
          ended: false,
          events: [],
          kind: options.kind,
          name: options.name ?? options.operation,
          operation: options.operation,
          parent: options.parent,
        };
        spans.push(span);

        return {
          context: span.context,
          addEvent(name: string, event?: { attributes?: Record<string, unknown> }) {
            span.events.push({ attributes: event?.attributes, name });
          },
          end() {
            span.ended = true;
          },
          setAttribute(name: string, value: unknown) {
            span.attributes[name] = value;
          },
          setName(name: string) {
            span.name = name;
          },
          setStatus(status: RuntimeSpanStatus) {
            span.status = status;
          },
        };
      },
    }),
    spans,
  };
}

function spanId(context: RuntimeSpanContext | undefined) {
  return (context as { spanId?: string } | undefined)?.spanId;
}

function instrumentedRoutes() {
  const middleware = defineMiddleware(async (_context, next) => await next());

  return {
    "./routes/@middleware.ts": async () => ({ middleware }),
    "./routes/posts/[slug].tsx": routeModule({
      GET: page<string, { message: string }>({
        data: () => ({ message: "Hello" }),
        view: View as ComponentType<RouteProps<string, { message: string }>>,
      }),
      POST: mutation({ handler: () => json({ saved: true }) }),
    }),
  };
}

describe("request pipeline instrumentation", () => {
  it("records the document lifecycle with direct request children", async () => {
    const recorder = createRecorder();
    const handler = createRequestHandler({
      routes: instrumentedRoutes(),
      runtimeInstrumentation: recorder.runtimeInstrumentation,
    });

    const response = await handler(
      new Request("https://example.test/posts/private-value?token=secret"),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("Hello");
    expect(recorder.spans.map((span) => span.name)).toEqual([
      "GET /posts/[slug]",
      "demiurge.middleware",
      "demiurge.route.data",
      "demiurge.render",
    ]);

    const [request, ...children] = recorder.spans;
    expect(request).toMatchObject({
      attributes: {
        "demiurge.operation.outcome": "success",
        "http.request.method": "GET",
        "http.response.status_code": 200,
        "http.route": "/posts/[slug]",
        "url.scheme": "https",
      },
      ended: true,
      kind: "server",
      status: "unset",
    });
    expect(children.every((span) =>
      spanId(span.parent) === spanId(request?.context) && span.ended
    )).toBe(true);
    expect(recorder.spans.find((span) => span.name === "demiurge.render"))
      .toMatchObject({
        attributes: {
          "demiurge.operation.outcome": "success",
          "demiurge.render.mode": "ssr",
        },
      });
    expect(JSON.stringify(recorder.spans)).not.toContain("private-value");
    expect(JSON.stringify(recorder.spans)).not.toContain("token");
    expect(JSON.stringify(recorder.spans)).not.toContain("secret");
  });

  it("records navigation data without a render span", async () => {
    const recorder = createRecorder();
    const handler = createRequestHandler({
      routes: instrumentedRoutes(),
      runtimeInstrumentation: recorder.runtimeInstrumentation,
    });

    const response = await handler(
      new Request("https://example.test/posts/one", {
        headers: { "x-demiurge-navigation": "data" },
      }),
    );

    expect(response.status).toBe(200);
    expect(recorder.spans.map((span) => span.name)).toEqual([
      "GET /posts/[slug]",
      "demiurge.middleware",
      "demiurge.route.data",
    ]);
  });

  it("records a mutation as a direct request child", async () => {
    const recorder = createRecorder();
    const handler = createRequestHandler({
      routes: instrumentedRoutes(),
      runtimeInstrumentation: recorder.runtimeInstrumentation,
    });

    const response = await handler(
      new Request("https://example.test/posts/one", {
        headers: { [MUTATION_REQUEST_HEADER]: MUTATION_REQUEST_VALUE },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(recorder.spans.map((span) => span.name)).toEqual([
      "POST /posts/[slug]",
      "demiurge.middleware",
      "demiurge.route.mutation",
    ]);
    expect(recorder.spans[2]?.parent).toEqual(recorder.spans[0]?.context);
  });

  it("keeps instrumentation optional", async () => {
    const handler = createRequestHandler({ routes: instrumentedRoutes() });

    const response = await handler(
      new Request("https://example.test/posts/one"),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("Hello");
  });

  it("uses a bounded method for unmatched HTTP methods", async () => {
    const recorder = createRecorder();
    const handler = createRequestHandler({
      routes: instrumentedRoutes(),
      runtimeInstrumentation: recorder.runtimeInstrumentation,
    });

    const response = await handler(
      new Request("https://example.test/posts/one", { method: "CUSTOM" }),
    );
    await response.text();

    expect(recorder.spans[0]).toMatchObject({
      attributes: {
        "http.request.method": "_OTHER",
        "http.route": "/posts/[slug]",
      },
      name: "_OTHER /posts/[slug]",
    });
  });

  it("records fallback document rendering", async () => {
    const recorder = createRecorder();
    const handler = createRequestHandler({
      routes: instrumentedRoutes(),
      runtimeInstrumentation: recorder.runtimeInstrumentation,
    });

    const response = await handler(
      new Request("https://example.test/missing", {
        headers: { accept: "text/html" },
      }),
    );
    await response.text();

    expect(response.status).toBe(404);
    expect(recorder.spans.map((span) => span.operation)).toEqual([
      "demiurge.request",
      "demiurge.render",
    ]);
  });

  it.each(["synchronous", "asynchronous"] as const)(
    "isolates %s lifecycle failures from the response",
    async (failureKind) => {
      const error = new Error("instrumentation failed");
      const onError = vi.fn();
      const fail = failureKind === "synchronous"
        ? () => { throw error; }
        : async () => { throw error; };
      const handler = createRequestHandler({
        routes: instrumentedRoutes(),
        runtimeInstrumentation: defineRuntimeInstrumentation({
          onError,
          startSpan() {
            return {
              context: { spanId: "failed-span" },
              addEvent: fail,
              end: fail,
              setAttribute: fail,
              setName: fail,
              setStatus: fail,
            };
          },
        }),
      });

      const response = await handler(
        new Request("https://example.test/posts/one"),
      );

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toContain("Hello");
      expect(onError).toHaveBeenCalled();
      for (const call of onError.mock.calls) {
        expect(call[0]).toEqual(expect.objectContaining({
          failure: expect.any(String),
          operation: expect.stringMatching(/^demiurge\./),
        }));
        expect(JSON.stringify(call[0])).not.toContain("instrumentation failed");
      }
    },
  );

  it("records a server error without exposing its message", async () => {
    const recorder = createRecorder();
    const handler = createRequestHandler({
      onError: () => {},
      routes: {
        "./routes/failure.ts": routeModule({
          GET: json(() => { throw new Error("private database failure"); }),
        }),
      },
      runtimeInstrumentation: recorder.runtimeInstrumentation,
    });

    const response = await handler(new Request("https://example.test/failure"));

    expect(response.status).toBe(500);
    expect(recorder.spans[0]).toMatchObject({
      attributes: {
        "demiurge.operation.outcome": "error",
        "http.response.status_code": 500,
      },
      status: "error",
    });
    expect(JSON.stringify(recorder.spans)).not.toContain("private database failure");
  });

  it("records a bounded exception event for failed route data", async () => {
    const recorder = createRecorder();
    const handler = createRequestHandler({
      onError: () => {},
      routes: {
        "./routes/failure.tsx": routeModule({
          GET: page({
            data: () => {
              throw new Error("private data failure");
            },
            view: View as ComponentType<RouteProps<string, { message: string }>>,
          }),
        }),
      },
      runtimeInstrumentation: recorder.runtimeInstrumentation,
    });

    const response = await handler(new Request("https://example.test/failure"));
    await response.text();
    const dataSpan = recorder.spans.find(
      (span) => span.operation === "demiurge.route.data",
    );

    expect(dataSpan?.events).toEqual([{
      attributes: { "error.type": "exception" },
      name: "exception",
    }]);
    expect(recorder.spans.find(
      (span) => span.operation === "demiurge.render",
    )).toMatchObject({
      attributes: {
        "demiurge.operation.outcome": "success",
        "demiurge.render.mode": "ssr",
      },
    });
    expect(JSON.stringify(dataSpan)).not.toContain("private data failure");
  });

  it("records response stream failures on the request span", async () => {
    const recorder = createRecorder();
    const handler = createRequestHandler({
      routes: {
        "./routes/failure.ts": routeModule({
          GET: rawResponse(() => new Response(new ReadableStream({
            pull(controller) {
              controller.error(new Error("private stream failure"));
            },
          }))),
        }),
      },
      runtimeInstrumentation: recorder.runtimeInstrumentation,
    });

    const response = await handler(new Request("https://example.test/failure"));
    await expect(response.text()).rejects.toThrow("private stream failure");
    const requestSpan = recorder.spans[0];

    expect(requestSpan).toMatchObject({
      attributes: {
        "demiurge.operation.outcome": "error",
        "error.type": "exception",
      },
      ended: true,
      status: "error",
    });
    expect(requestSpan?.events).toEqual([{
      attributes: { "error.type": "exception" },
      name: "exception",
    }]);
    expect(JSON.stringify(requestSpan)).not.toContain("private stream failure");
  });
});
