import { describe, expect, it, vi } from "vitest";
import { defineInstrumentation } from "@demiurge/core";

describe("observability instrumentation", () => {
  it("dispatches typed signals to the event and signal handlers", async () => {
    const events: string[] = [];
    const instrumentation = defineInstrumentation({
      onEvent: (event) => {
        events.push(event.kind);
      },
      request: (signal) => {
        events.push(`${signal.method} ${signal.pathname}`);
      },
      webVitals: (signal) => {
        events.push(`${signal.name}:${signal.value}`);
      },
    });

    await instrumentation.request({
      duration: 12,
      method: "GET",
      pathname: "/posts/hello",
      status: 200,
    });
    await instrumentation.reportWebVitals({ name: "LCP", value: 842 });

    expect(events).toEqual([
      "request",
      "GET /posts/hello",
      "web-vital",
      "LCP:842",
    ]);
  });

  it("supports async handlers and defaults server start to an empty signal", async () => {
    const handler = vi.fn(async () => undefined);
    const instrumentation = defineInstrumentation({ serverStart: handler });

    await instrumentation.serverStart();

    expect(handler).toHaveBeenCalledWith({});
  });

  it("does not require a handler for any signal", async () => {
    const instrumentation = defineInstrumentation();

    await expect(
      Promise.all([
        instrumentation.serverStart({ adapter: "node" }),
        instrumentation.trace({ name: "render", status: "ok" }),
        instrumentation.request({ method: "POST", pathname: "/actions" }),
        instrumentation.reportWebVitals({ name: "CLS", value: 0.02 }),
      ]),
    ).resolves.toEqual([undefined, undefined, undefined, undefined]);
  });
});
