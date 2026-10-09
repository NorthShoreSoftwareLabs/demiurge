import {
  createTraceState,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  isSpanContextValid,
  trace,
  type Context,
  type Attributes,
  type AttributeValue,
  type Meter,
  type TextMapPropagator,
  type Tracer,
} from "@opentelemetry/api";
import {
  defineRuntimeInstrumentation,
  type RuntimeInstrumentation,
  type RuntimeInstrumentationOptions,
  type RuntimeSpanContext,
  type RuntimeSpanAttributeValue,
  type RuntimeSpanStartOptions,
} from "./platform/runtime-instrumentation";
import type { RuntimeTraceContextPropagator } from "./platform/trace-context";

const durationMetricName = "demiurge.operation.duration";
const nativeContexts = new WeakMap<object, Context>();

export type OpenTelemetryInstrumentationOptions = {
  allowBaggage?: boolean;
  meter?: Meter;
  onError?: RuntimeInstrumentationOptions["onError"];
  propagator?: TextMapPropagator;
  tracer: Tracer;
};

export function defineOpenTelemetryInstrumentation(
  options: OpenTelemetryInstrumentationOptions,
): RuntimeInstrumentation {
  const duration = options.meter?.createHistogram(durationMetricName, {
    description: "Duration of a Demiurge runtime operation.",
    unit: "s",
  });

  const traceContext: RuntimeTraceContextPropagator = {
    allowBaggage: options.allowBaggage === true,
    extract(headers, fallback) {
      if (options.propagator) {
        const extracted = options.propagator.extract(
          ROOT_CONTEXT,
          headers,
          headerGetter,
        );
        const spanContext = trace.getSpanContext(extracted);
        return spanContext && isSpanContextValid(spanContext)
          ? wrapContext(extracted)
          : wrapContext(contextWithRemoteSpan(fallback));
      }
      return wrapContext(contextWithRemoteSpan(fallback));
    },
    inject(runtimeContext, headers) {
      const nativeContext = unwrapContext(runtimeContext);
      if (!nativeContext) return;
      if (options.propagator) {
        options.propagator.inject(nativeContext, headers, headerSetter);
        return;
      }
      const spanContext = trace.getSpanContext(nativeContext);
      if (!spanContext || !isSpanContextValid(spanContext)) return;
      headers.set(
        "traceparent",
        `00-${spanContext.traceId}-${spanContext.spanId}-${spanContext.traceFlags.toString(16).padStart(2, "0")}`,
      );
      const traceState = spanContext.traceState?.serialize();
      if (traceState) {
        headers.set("tracestate", traceState);
      } else {
        headers.delete("tracestate");
      }
    },
  };

  return defineRuntimeInstrumentation({
    onError: options.onError,
    traceContext,
    startSpan(spanOptions) {
      const parentContext = parentForSpan(spanOptions);
      const startedAt = performance.now();
      const span = options.tracer.startSpan(
        spanOptions.name ?? spanOptions.operation,
        {
          kind: toSpanKind(spanOptions.kind),
          links: spanOptions.links?.flatMap((link) => {
            const linkContext = contextFromRuntimeContext(link.context);
            const spanContext = linkContext && trace.getSpanContext(linkContext);
            return spanContext && isSpanContextValid(spanContext)
              ? [{ context: spanContext, attributes: toOtelAttributes(link.attributes) }]
              : [];
          }),
          attributes: toOtelAttributes(spanOptions.attributes),
        },
        parentContext,
      );
      const runtimeContext = wrapContext(
        trace.setSpan(parentContext, span),
      );
      let ended = false;
      return {
        context: runtimeContext,
        addEvent(name, eventOptions) {
          span.addEvent(name, toOtelAttributes(eventOptions?.attributes));
        },
        end() {
          if (ended) return;
          ended = true;
          try {
            if (duration) {
              duration.record(
                Math.max(0, (performance.now() - startedAt) / 1_000),
                { "demiurge.operation": spanOptions.operation },
              );
            }
          } finally {
            span.end();
          }
        },
        setAttribute(name, value) {
          span.setAttribute(name, toOtelAttributeValue(value));
        },
        setName(name) {
          span.updateName(name);
        },
        setStatus(status) {
          if (status === "error") {
            span.setStatus({ code: SpanStatusCode.ERROR });
          } else if (status === "ok") {
            span.setStatus({ code: SpanStatusCode.OK });
          } else {
            span.setStatus({ code: SpanStatusCode.UNSET });
          }
        },
      };
    },
  });
}

function parentForSpan(options: RuntimeSpanStartOptions) {
  if (options.parent) {
    const parent = contextFromRuntimeContext(options.parent);
    if (parent) return parent;
    return ROOT_CONTEXT;
  }
  return ROOT_CONTEXT;
}

function contextFromRuntimeContext(runtimeContext: RuntimeSpanContext) {
  const native = unwrapContext(runtimeContext);
  if (native) return native;

  const traceId = runtimeContext.traceId;
  const spanId = runtimeContext.spanId;
  const traceFlags = runtimeContext.traceFlags;
  const traceState = runtimeContext.traceState;
  if (
    typeof traceId !== "string" ||
    typeof spanId !== "string" ||
    typeof traceFlags !== "number" ||
    !Number.isInteger(traceFlags) ||
    traceFlags < 0 ||
    traceFlags > 255
  ) return undefined;

  const context = trace.setSpanContext(ROOT_CONTEXT, {
    traceId,
    spanId,
    traceFlags,
    isRemote: true,
    ...(typeof traceState === "string"
      ? { traceState: createTraceState(traceState) }
      : {}),
  });
  const candidate = trace.getSpanContext(context);
  return candidate && isSpanContextValid(candidate) ? context : undefined;
}

function contextWithRemoteSpan(spanContext: {
  sampled: boolean;
  spanId: string;
  traceFlags: number;
  traceId: string;
  traceState?: string;
}) {
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceFlags: spanContext.traceFlags,
    traceState: spanContext.traceState
      ? createTraceState(spanContext.traceState)
      : undefined,
    isRemote: true,
  });
}

function wrapContext(context: Context): RuntimeSpanContext {
  const wrapped: RuntimeSpanContext = {};
  nativeContexts.set(wrapped, context);
  return wrapped;
}

function unwrapContext(runtimeContext: RuntimeSpanContext) {
  return nativeContexts.get(runtimeContext);
}

const headerGetter = {
  get(carrier: Headers, key: string) {
    return carrier.get(key) ?? undefined;
  },
  keys(carrier: Headers) {
    return [...carrier.keys()];
  },
};

const headerSetter = {
  set(carrier: Headers, key: string, value: string) {
    carrier.set(key, value);
  },
};

function toSpanKind(kind: RuntimeSpanStartOptions["kind"]) {
  switch (kind) {
    case "client":
      return SpanKind.CLIENT;
    case "server":
      return SpanKind.SERVER;
    case "internal":
      return SpanKind.INTERNAL;
  }
}

function toOtelAttributes(
  attributes: RuntimeSpanStartOptions["attributes"],
): Attributes | undefined {
  if (!attributes) return undefined;
  return Object.fromEntries(
    Object.entries(attributes).map(([name, value]) => [
      name,
      toOtelAttributeValue(value),
    ]),
  );
}

function toOtelAttributeValue(
  value: RuntimeSpanAttributeValue,
): AttributeValue {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value.length === 0) return [];
  if (typeof value[0] === "string") {
    return value.map((item) => String(item));
  }
  if (typeof value[0] === "boolean") {
    return value.map((item) => Boolean(item));
  }
  return value.map((item) => Number(item));
}
