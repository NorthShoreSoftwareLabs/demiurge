import { context, ROOT_CONTEXT, trace, type Context, type TextMapPropagator } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { describe, expect, it, vi } from "vitest";
import { defineOpenTelemetryInstrumentation } from "../../src/opentelemetry";
import type { RuntimeSpanStartOptions } from "../../src/platform/runtime-instrumentation";

const requestOptions: RuntimeSpanStartOptions = {
  kind: "server",
  operation: "demiurge.request",
  attributes: { "http.request.method": "GET" },
};

describe("OpenTelemetry runtime instrumentation", () => {
  it("records spans, events, names, attributes, statuses, and links with the SDK", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const instrumentation = defineOpenTelemetryInstrumentation({
      tracer: provider.getTracer("demiurge-test"),
    });
    const parent = instrumentation.startSpan(requestOptions);
    expect(parent).toBeDefined();
    parent?.setName("GET /orders");
    parent?.setAttribute("app.region", "east");
    parent?.setAttribute("app.values", ["one", "two"]);
    parent?.setAttribute("app.flags", [true, false]);
    parent?.setAttribute("app.empty", []);
    parent?.addEvent("response.sent", { attributes: { "app.code": 202 } });
    parent?.setStatus("error");

    const child = instrumentation.startSpan({
      kind: "internal",
      operation: "demiurge.render",
      parent: parent?.context,
      links: parent ? [{ context: parent.context }] : undefined,
    });
    child?.setStatus("ok");
    child?.end();
    parent?.end();
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans.map((span) => span.name)).toEqual([
      "demiurge.render",
      "GET /orders",
    ]);
    expect(spans[0]?.parentSpanContext?.spanId).toBe(spans[1]?.spanContext().spanId);
    expect(spans[0]?.links).toHaveLength(1);
    expect(spans[1]?.status.code).toBe(2);
    expect(spans[0]?.status.code).toBe(1);
    expect(spans[1]?.events[0]?.name).toBe("response.sent");
    expect(spans[1]?.attributes["app.region"]).toBe("east");
    await provider.shutdown();
  });

  it("keeps unsampled remote parents and ignores ambient context", async () => {
    const contextManager = new AsyncLocalStorageContextManager().enable();
    context.setGlobalContextManager(contextManager);
    try {
      const provider = new BasicTracerProvider();
      const instrumentation = defineOpenTelemetryInstrumentation({
        tracer: provider.getTracer("demiurge-test"),
      });
      const remote = instrumentation.traceContext?.extract?.(
        new Headers(),
        {
          isRemote: true,
          sampled: false,
          spanId: "0123456789abcdef",
          traceFlags: 0,
          traceId: "0123456789abcdef0123456789abcdef",
          traceState: "vendor=value",
        },
      );
      expect(remote).toBeDefined();
      const child = instrumentation.startSpan({
        ...requestOptions,
        parent: remote,
      });
      const outgoing = new Headers();
      if (child) instrumentation.traceContext?.inject?.(child.context, outgoing);
      expect(outgoing.get("traceparent")).toMatch(
        /^00-0123456789abcdef0123456789abcdef-[0-9a-f]{16}-00$/,
      );
      expect(outgoing.get("tracestate")).toBe("vendor=value");
      child?.end();

      const ambient = trace.setSpanContext(ROOT_CONTEXT, {
        traceId: "fedcba9876543210fedcba9876543210",
        spanId: "fedcba9876543210",
        traceFlags: 1,
        isRemote: false,
      });
      context.with(ambient, () => {
        const root = instrumentation.startSpan(requestOptions);
        const headers = new Headers();
        if (root) instrumentation.traceContext?.inject?.(root.context, headers);
        expect(headers.get("traceparent")).not.toContain("fedcba9876543210");
        root?.end();
      });
      await provider.shutdown();
    } finally {
      contextManager.disable();
      context.disable();
    }
  });

  it("records operation durations with only a closed operation label", async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 60_000,
    });
    const provider = new MeterProvider({ readers: [reader] });
    const traceProvider = new BasicTracerProvider();
    const instrumentation = defineOpenTelemetryInstrumentation({
      tracer: traceProvider.getTracer("demiurge-metrics"),
      meter: provider.getMeter("demiurge-metrics"),
    });
    const span = instrumentation.startSpan({
      ...requestOptions,
      attributes: {
        ...requestOptions.attributes,
        "app.secret": "private-value",
      },
    });
    span?.end();
    await provider.forceFlush();
    const metric = exporter.getMetrics()
      .flatMap((resource) => resource.scopeMetrics)
      .flatMap((scope) => scope.metrics)
      .find((entry) => entry.descriptor.name === "demiurge.operation.duration");
    expect(metric?.dataPointType).toBe(DataPointType.HISTOGRAM);
    if (metric?.dataPointType === DataPointType.HISTOGRAM) {
      expect(metric.descriptor.unit).toBe("s");
      expect(metric.dataPoints).toHaveLength(1);
      expect(metric.dataPoints[0]?.value.count).toBe(1);
      expect(metric.dataPoints[0]?.value.sum).toBeGreaterThanOrEqual(0);
      expect(metric.dataPoints[0]?.attributes).toEqual({
        "demiurge.operation": "demiurge.request",
      });
    }
    await provider.shutdown();
    await traceProvider.shutdown();
  });

  it("still ends an SDK span once when metric recording fails", async () => {
    const exporter = new InMemorySpanExporter();
    const traceProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const record = vi.fn(() => {
      throw new Error("metric failure");
    });
    const createHistogram = vi.fn(() => ({ record }));
    const errors: string[] = [];
    const instrumentation = defineOpenTelemetryInstrumentation({
      tracer: traceProvider.getTracer("demiurge-metrics-failure"),
      meter: { createHistogram } as never,
      onError: (error) => {
        errors.push(error.failure);
      },
    });
    const span = instrumentation.startSpan({
      ...requestOptions,
      kind: "client",
    });
    span?.end();
    span?.end();
    expect(createHistogram).toHaveBeenCalledWith(
      "demiurge.operation.duration",
      expect.objectContaining({ unit: "s" }),
    );
    expect(record).toHaveBeenCalledWith(
      expect.any(Number),
      { "demiurge.operation": "demiurge.request" },
    );
    expect(errors).toEqual(["end"]);
    await traceProvider.forceFlush();
    expect(exporter.getFinishedSpans()).toHaveLength(1);
    expect(record).toHaveBeenCalledTimes(1);
    await traceProvider.shutdown();
  });

  it("uses an application propagator and accepts canonical span contexts", async () => {
    let extractedFrom: Context | undefined;
    const propagator: TextMapPropagator = {
      fields: () => ["x-trace"],
      extract(parent, carrier, getter) {
        extractedFrom = parent;
        expect(getter.get(carrier, "x-trace")).toBe("remote");
        expect(getter.get(carrier, "baggage")).toBe("tenant=blue");
        expect(getter.keys(carrier)).toContain("x-trace");
        return trace.setSpanContext(parent, {
          traceId: "0123456789abcdef0123456789abcdef",
          spanId: "0123456789abcdef",
          traceFlags: 1,
          isRemote: true,
        });
      },
      inject(_context, carrier, setter) {
        setter.set(carrier, "x-trace", "written");
      },
    };
    const provider = new BasicTracerProvider();
    const instrumentation = defineOpenTelemetryInstrumentation({
      tracer: provider.getTracer("demiurge-propagator"),
      propagator,
      allowBaggage: true,
    });
    const remote = instrumentation.traceContext?.extract?.(
      new Headers({ "x-trace": "remote", baggage: "tenant=blue" }),
      {
        isRemote: true,
        sampled: true,
        spanId: "fedcba9876543210",
        traceFlags: 1,
        traceId: "fedcba9876543210fedcba9876543210",
      },
    );
    expect(extractedFrom).toBe(ROOT_CONTEXT);
    const span = instrumentation.startSpan({
      ...requestOptions,
      parent: {
        traceId: "0123456789abcdef0123456789abcdef",
        spanId: "0123456789abcdef",
        traceFlags: 1,
      },
      links: remote ? [{ context: remote }] : undefined,
    });
    const headers = new Headers();
    if (span) instrumentation.traceContext?.inject?.(span.context, headers);
    expect(headers.get("x-trace")).toBe("written");
    span?.end();
    await provider.shutdown();
  });

  it("starts a root span when an explicit remote context is invalid", async () => {
    const provider = new BasicTracerProvider();
    const instrumentation = defineOpenTelemetryInstrumentation({
      tracer: provider.getTracer("demiurge-invalid-parent"),
    });
    const span = instrumentation.startSpan({
      ...requestOptions,
      parent: {
        traceId: "00000000000000000000000000000000",
        spanId: "0123456789abcdef",
        traceFlags: 256,
      },
    });
    const headers = new Headers();
    if (span) instrumentation.traceContext?.inject?.(span.context, headers);
    expect(headers.get("traceparent")).not.toContain(
      "00000000000000000000000000000000",
    );
    span?.end();
    await provider.shutdown();
  });

  it("uses the valid W3C parent when an application propagator returns no context", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const instrumentation = defineOpenTelemetryInstrumentation({
      tracer: provider.getTracer("demiurge-propagator-fallback"),
      propagator: {
        fields: () => [],
        extract: (parent) => parent,
        inject: () => {},
      },
    });
    const parent = instrumentation.traceContext?.extract?.(
      new Headers(),
      {
        isRemote: true,
        sampled: true,
        spanId: "0123456789abcdef",
        traceFlags: 1,
        traceId: "0123456789abcdef0123456789abcdef",
      },
    );
    const span = instrumentation.startSpan({ ...requestOptions, parent });
    span?.end();
    await provider.forceFlush();
    expect(exporter.getFinishedSpans()[0]?.parentSpanContext?.traceId).toBe(
      "0123456789abcdef0123456789abcdef",
    );
    await provider.shutdown();
  });
});
