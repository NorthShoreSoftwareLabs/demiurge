import { describe, expect, it, vi, type Mock } from "vitest";
import {
  createRequestHandler,
  defineAdapter,
  defineRuntimeInstrumentation,
  json,
  mutation,
  MUTATION_REQUEST_HEADER,
  MUTATION_REQUEST_VALUE,
  page,
  text,
  type RouteModule,
  type RouteProps,
  type RuntimeSpanAttributeValue,
  type RuntimeSpanOperation,
  type RuntimeSpanStartOptions,
} from "@demiurgejs/core";
import { createEdgeRequestHandler } from "@demiurgejs/core/edge";

function View({ data }: RouteProps<string, { message: string }>) {
  return <main>{data.message}</main>;
}

type RecordedSpan = {
  attributes: Record<string, RuntimeSpanAttributeValue>;
  end: Mock<() => void>;
  operation: RuntimeSpanOperation;
};

function createRecorder() {
  const spans: RecordedSpan[] = [];
  const runtimeInstrumentation = defineRuntimeInstrumentation({
    startSpan(options: RuntimeSpanStartOptions) {
      const span: RecordedSpan = {
        attributes: { ...options.attributes },
        end: vi.fn(),
        operation: options.operation,
      };
      spans.push(span);

      return {
        context: {},
        end: span.end,
        setAttribute(name, value) {
          span.attributes[name] = value;
        },
      };
    },
  });

  return { runtimeInstrumentation, spans };
}

function routeModule(module: RouteModule) {
  return async () => ({
    ...module,
    policy: { access: { public: true }, ...module.policy },
  });
}

const routes = {
  "./routes/index.ts": routeModule({ GET: text("ready") }),
};

const pageRoutes = {
  "./routes/posts/[slug].tsx": routeModule({
    GET: page({
      data: () => ({ message: "ready" }),
      view: View,
    }),
    POST: mutation({ handler: () => json({ saved: true }) }),
  }),
};

describe("request instrumentation adapter behavior", () => {
  it("ends an edge request span when the adapter hands off the response", async () => {
    const recorder = createRecorder();
    const handler = createEdgeRequestHandler({
      cacheStore: "unavailable",
      rateLimitStore: "unavailable",
      routes,
      runtimeInstrumentation: recorder.runtimeInstrumentation,
    });

    const response = await handler(new Request("https://edge.test/"));
    const requestSpan = recorder.spans.find(
      (span) => span.operation === "demiurge.request",
    );

    expect(response.bodyUsed).toBe(false);
    expect(requestSpan).toMatchObject({
      attributes: {
        "demiurge.response.body_observation": "handoff",
        "http.response.status_code": 200,
      },
    });
    expect(requestSpan?.end).toHaveBeenCalledOnce();
  });

  it("keeps a shared request span open until its body completes", async () => {
    const recorder = createRecorder();
    const handler = createRequestHandler({
      routes,
      runtimeInstrumentation: recorder.runtimeInstrumentation,
    });

    const response = await handler(new Request("https://node.test/"));
    const requestSpan = recorder.spans.find(
      (span) => span.operation === "demiurge.request",
    );

    expect(requestSpan).toMatchObject({
      attributes: {
        "demiurge.response.body_observation": "completion",
        "http.response.status_code": 200,
      },
    });
    expect(requestSpan?.end).not.toHaveBeenCalled();

    await expect(response.text()).resolves.toBe("ready");
    expect(requestSpan?.end).toHaveBeenCalledOnce();
  });

  it.each([
    {
      adapter: defineAdapter({
        capabilities: { responseBodyCompletion: true },
        name: "edge",
      }),
      expected: "completion",
    },
    {
      adapter: defineAdapter({ name: "custom" }),
      expected: "handoff",
    },
  ] as const)(
    "selects $expected body observation from the adapter capability",
    async ({ adapter, expected }) => {
      const recorder = createRecorder();
      const handler = createRequestHandler({
        adapter,
        routes,
        runtimeInstrumentation: recorder.runtimeInstrumentation,
      });

      const response = await handler(new Request("https://adapter.test/"));
      const requestSpan = recorder.spans.find(
        (span) => span.operation === "demiurge.request",
      );

      expect(requestSpan?.attributes).toMatchObject({
        "demiurge.response.body_observation": expected,
      });
      expect(requestSpan?.end).toHaveBeenCalledTimes(
        expected === "handoff" ? 1 : 0,
      );
      await response.text();
    },
  );

  it.each([
    {
      expected: ["demiurge.request", "demiurge.route.data", "demiurge.render"],
      request: new Request("https://edge.test/posts/one"),
    },
    {
      expected: ["demiurge.request", "demiurge.route.data"],
      request: new Request("https://edge.test/posts/one", {
        headers: { "x-demiurge-navigation": "data" },
      }),
    },
    {
      expected: ["demiurge.request", "demiurge.route.mutation"],
      request: new Request("https://edge.test/posts/one", {
        headers: { [MUTATION_REQUEST_HEADER]: MUTATION_REQUEST_VALUE },
        method: "POST",
      }),
    },
  ])("keeps the shared lifecycle at the edge", async ({ expected, request }) => {
    const recorder = createRecorder();
    const handler = createEdgeRequestHandler({
      cacheStore: "unavailable",
      rateLimitStore: "unavailable",
      routes: pageRoutes,
      runtimeInstrumentation: recorder.runtimeInstrumentation,
    });

    const response = await handler(request);

    expect(response.status).toBe(200);
    expect(recorder.spans.map((span) => span.operation)).toEqual(expected);
  });
});
