import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";
import {
  createRequestHandler,
  defineRuntimeInstrumentation,
  page,
  type RuntimeSpanContext,
  type RuntimeSpanStartOptions,
  type RouteModule,
  type RouteProps,
} from "@demiurgejs/core";

function View({ data }: RouteProps<string, { message: string }>) {
  return <main>{data.message}</main>;
}

describe("request trace context", () => {
  it("preserves an unsampled remote parent when the request span is not recorded", async () => {
    const outbound = new Headers();
    const spans: Array<RuntimeSpanStartOptions> = [];
    const requestContext: RuntimeSpanContext = {
      isRemote: true,
      sampled: false,
      spanId: "00f067aa0ba902b7",
      traceFlags: 0,
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    };
    const handler = createRequestHandler({
      routes: {
        "./routes/index.tsx": async () => ({
          GET: page<string, { message: string }>({
            data: ({ trace }) => {
              trace?.inject(outbound);
              return { message: "ready" };
            },
            view: View as ComponentType<RouteProps<string, { message: string }>>,
          }),
          policy: { access: { public: true } },
        } satisfies RouteModule),
      },
      runtimeInstrumentation: defineRuntimeInstrumentation({
        startSpan(options) {
          spans.push(options);
          if (options.operation === "demiurge.request") return undefined;
          return {
            context: {
              spanId: "828c5d0d435ba505",
              traceFlags: 0,
              traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
            },
            end() {},
          };
        },
      }),
    });

    const response = await handler(new Request("https://example.test/", {
      headers: {
        traceparent:
          "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00",
      },
    }));
    await response.text();

    expect(spans[0].parent).toMatchObject(requestContext);
    expect(spans.find((span) => span.operation === "demiurge.route.data")?.parent)
      .toMatchObject(requestContext);
    expect(outbound.get("traceparent")).toBe(
      "00-4bf92f3577b34da6a3ce929d0e0e4736-828c5d0d435ba505-00",
    );
  });
});
