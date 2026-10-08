import { describe, expect, it, vi } from "vitest";
import {
  defineRuntimeInstrumentation,
  RUNTIME_INSTRUMENTATION_CONVENTION_VERSION,
  startRuntimeSpan,
  type RuntimeSpanImplementation,
} from "@demiurgejs/core";

describe("runtime instrumentation", () => {
  it("exports convention version one and preserves explicit parents", () => {
    const parent = {};
    const context = {};
    const startSpan = vi.fn(() => ({ context, end: vi.fn() }));
    const instrumentation = defineRuntimeInstrumentation({ startSpan });

    const span = instrumentation.startSpan({
      kind: "internal",
      operation: "demiurge.render",
      parent,
    });

    expect(RUNTIME_INSTRUMENTATION_CONVENTION_VERSION).toBe(1);
    expect(startSpan).toHaveBeenCalledWith(expect.objectContaining({ parent }));
    expect(span?.context).toBe(context);
  });

  it("guards synchronous and asynchronous lifecycle failures", async () => {
    const errors: string[] = [];
    const implementation: RuntimeSpanImplementation = {
      context: {},
      addEvent: () => Promise.reject(new Error("event")),
      end: () => {
        throw new Error("end");
      },
      setName: () => Promise.reject(new Error("name")),
    };
    const instrumentation = defineRuntimeInstrumentation({
      onError: (error) => {
        errors.push(error.failure);
      },
      startSpan: () => implementation,
    });
    const span = instrumentation.startSpan({
      kind: "server",
      operation: "demiurge.request",
    });

    span?.addEvent("failure");
    span?.setName("GET /items/:id");
    span?.end();
    expect(errors).toEqual(["end"]);

    await Promise.resolve();
    await Promise.resolve();
    expect(errors).toEqual(["end", "add-event", "set-name"]);
  });

  it("contains start and error callback failures without recursion", () => {
    const onError = vi.fn(() => {
      throw new Error("callback");
    });
    const instrumentation = defineRuntimeInstrumentation({
      onError,
      startSpan: () => {
        throw new Error("start");
      },
    });

    expect(() => instrumentation.startSpan({
      kind: "server",
      operation: "demiurge.request",
    })).not.toThrow();
    expect(onError).toHaveBeenCalledWith({
      failure: "start-span",
      operation: "demiurge.request",
    });
  });

  it("preserves method receivers and guards context access", () => {
    const onError = vi.fn();
    const implementation = {
      context: {},
      ended: false,
      end() {
        this.ended = true;
      },
    };
    const instrumentation = defineRuntimeInstrumentation({
      onError,
      startSpan: () => implementation,
    });

    instrumentation.startSpan({
      kind: "server",
      operation: "demiurge.request",
    })?.end();

    expect(implementation.ended).toBe(true);

    const invalid = defineRuntimeInstrumentation({
      onError,
      startSpan: () => ({
        get context(): Readonly<Record<string, unknown>> {
          throw new Error("context");
        },
        end() {},
      }),
    });

    expect(invalid.startSpan({
      kind: "server",
      operation: "demiurge.request",
    })).toBeUndefined();
    expect(onError).toHaveBeenCalledWith({
      failure: "start-span",
      operation: "demiurge.request",
    });
  });

  it("contains a rejected error callback", async () => {
    const instrumentation = defineRuntimeInstrumentation({
      onError: async () => {
        throw new Error("callback");
      },
      startSpan: () => {
        throw new Error("start");
      },
    });

    expect(() => instrumentation.startSpan({
      kind: "server",
      operation: "demiurge.request",
    })).not.toThrow();
    await Promise.resolve();
  });

  it("drops invalid attributes and enforces application limits", () => {
    const setAttribute = vi.fn();
    let forwardedAttributes: Readonly<Record<string, unknown>> | undefined;
    const startSpan = vi.fn((options: { attributes?: Readonly<Record<string, unknown>> }) => {
      forwardedAttributes = options.attributes;
      return { context: {}, end: vi.fn(), setAttribute };
    });
    const onError = vi.fn();
    const instrumentation = defineRuntimeInstrumentation({ onError, startSpan });
    const attributes = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [`app.value${index}`, index]),
    );
    const span = instrumentation.startSpan({
      attributes: {
        ...attributes,
        "demiurge.operation.outcome": "success",
        unknown: "drop",
      },
      kind: "internal",
      operation: "demiurge.route.data",
    });

    expect(Object.keys(forwardedAttributes ?? {})).toHaveLength(33);
    expect(forwardedAttributes).not.toHaveProperty("app.value32");
    expect(forwardedAttributes).not.toHaveProperty("unknown");

    span?.setAttribute("app.accepted", "no available slot");
    span?.setAttribute("app.value0", "updated");
    span?.setAttribute("app.long", "x".repeat(1_025));
    span?.setAttribute("http.route", "/items/:id");

    expect(setAttribute).toHaveBeenCalledTimes(2);
    expect(setAttribute).toHaveBeenCalledWith("app.value0", "updated");
    expect(setAttribute).toHaveBeenCalledWith("http.route", "/items/:id");
    expect(onError).toHaveBeenCalled();
  });

  it("validates link and event attribute arrays", () => {
    const addEvent = vi.fn();
    const startSpan = vi.fn(() => ({ context: {}, addEvent, end: vi.fn() }));
    const onError = vi.fn();
    const instrumentation = defineRuntimeInstrumentation({ onError, startSpan });
    const span = instrumentation.startSpan({
      kind: "internal",
      links: [{
        attributes: {
          "app.empty": [],
          "app.mixed": [1, "two"],
          "app.nan": [Number.NaN],
        },
        context: {},
      }],
      operation: "demiurge.render",
    });

    span?.addEvent("render", {
      attributes: { "app.mixed": [true, "false"] },
    });

    expect(startSpan).toHaveBeenCalledWith(expect.objectContaining({
      links: [{ attributes: { "app.empty": [] }, context: {} }],
    }));
    expect(addEvent).toHaveBeenCalledWith("render", { attributes: {} });
    expect(onError).toHaveBeenCalledTimes(3);
  });

  it("does not require an implementation", () => {
    const instrumentation = defineRuntimeInstrumentation();

    expect(instrumentation.startSpan({
      kind: "server",
      operation: "demiurge.request",
    })).toBeUndefined();
  });

  it("starts optional instrumentation through the request helper", () => {
    const end = vi.fn();
    const instrumentation = defineRuntimeInstrumentation({
      startSpan: () => ({ context: {}, end }),
    });
    const options = {
      kind: "server" as const,
      operation: "demiurge.request" as const,
    };

    startRuntimeSpan(instrumentation, options)?.end();

    expect(end).toHaveBeenCalledOnce();
    expect(startRuntimeSpan(undefined, options)).toBeUndefined();
    expect(startRuntimeSpan({ startSpan: () => {
      throw new Error("invalid implementation");
    } }, options)).toBeUndefined();
  });
});
