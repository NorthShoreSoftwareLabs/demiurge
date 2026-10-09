# OpenTelemetry runtime setup

Demiurge can send server spans and operation duration metrics to OpenTelemetry.
The application supplies OpenTelemetry providers and exporters to the runtime
integration. Core has no required OpenTelemetry SDK, provider, processor, or
exporter dependency.

## Install the application packages

Install the OpenTelemetry API and the SDK packages that your application uses.
Install exporter packages for your selected backend. Keep these dependencies in
the server application when browser code does not need them.

```sh
pnpm add @opentelemetry/api @opentelemetry/core
pnpm add @opentelemetry/sdk-trace-node @opentelemetry/sdk-trace-base
pnpm add @opentelemetry/sdk-metrics
```

OpenTelemetry supports several exporters. Use the [JavaScript exporter
guide](https://opentelemetry.io/docs/languages/js/exporters/) to select one.
Use a console exporter for local development. Use an OTLP exporter for a
collector or compatible backend.

## Create providers at server startup

Create the providers and exporters in server startup code. Pass their tracer
and meter to `defineOpenTelemetryInstrumentation`. The integration returns the
`RuntimeInstrumentation` value that Demiurge uses for runtime spans.

```js
import { defineOpenTelemetryInstrumentation } from "@demiurgejs/core/opentelemetry";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  ConsoleMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

const tracerProvider = new NodeTracerProvider({
  spanProcessors: [new BatchSpanProcessor(new ConsoleSpanExporter())],
});
const meterProvider = new MeterProvider({
  readers: [
    new PeriodicExportingMetricReader({
      exporter: new ConsoleMetricExporter(),
    }),
  ],
});
const runtimeInstrumentation = defineOpenTelemetryInstrumentation({
  tracer: tracerProvider.getTracer("my-application"),
  meter: meterProvider.getMeter("my-application"),
  propagator: new W3CTraceContextPropagator(),
});
```

Pass `runtimeInstrumentation` to `serveNodeBuild` and to the handler created
from the build. The integration records Demiurge spans and emits the
`demiurge.operation.duration` histogram when the application supplies a meter.
The histogram uses seconds as its unit.

```js
await serveNodeBuild({
  base: import.meta.url,
  createHandler: ({ page }) =>
    createHandler({ ...page, runtimeInstrumentation }),
  runtimeInstrumentation,
});
```

The application controls SDK registration. Demiurge uses the tracer
and meter that the application passes. Core does not register global providers
or automatic instrumentations.

## Choose a sampling policy

The JavaScript SDK uses a parent based sampler by default. Root traces are
sampled, and child spans follow the parent decision. Configure a sampler on
the tracer provider when the application must reduce trace volume. The SDK also
supports environment based sampler configuration. Read the [JavaScript
sampling guide](https://opentelemetry.io/docs/languages/js/sampling/) before
the application selects a production sampling rate.

Demiurge preserves a valid incoming sampling decision. A trace that is not
sampled can still propagate to an outgoing request. Sampling does not change
the HTTP response or other application behavior.

## Configure propagation

The `propagator` option accepts an OpenTelemetry `TextMapPropagator`. The
W3C trace context propagator handles `traceparent` and `tracestate`. The
integration uses it to extract request context and to inject context through
Demiurge's trace carrier.

Route data, mutations, and middleware can call `trace.inject(headers)` before
an outgoing fetch. Demiurge extracts a valid incoming trace context before it
starts the request span. The [trace context guide](./trace-context.md) describes
header limits, baggage policy, and carrier behavior.

Baggage propagation is disabled by default. Demiurge does not copy
baggage into span attributes.

## Flush and shut down providers

The application owns provider flush and shutdown. Drain the Demiurge Node
server first so its shutdown span can finish. Then flush and shut down the
providers before the process exits.

```js
const server = await serveNodeBuild({
  runtimeInstrumentation,
  shutdown: { signals: [] },
  // Add the other server options here.
});

async function shutdown() {
  const failures = [];
  const phases = [
    [() => server.shutdown()],
    [() => tracerProvider.forceFlush(), () => meterProvider.forceFlush()],
    [() => tracerProvider.shutdown(), () => meterProvider.shutdown()],
  ];
  for (const phase of phases) {
    const results = await Promise.allSettled(phase.map(async (run) => run()));
    for (const result of results) {
      if (result.status === "rejected") failures.push(result.reason);
    }
  }
  if (failures.length) throw new AggregateError(failures, "Shutdown failed.");
}

process.once("SIGTERM", () => {
  void shutdown().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
});
```

The [OpenTelemetry JavaScript context guide](https://opentelemetry.io/docs/languages/js/context/)
describes context managers. The [SDK trace specification](https://opentelemetry.io/docs/specs/otel/trace/sdk/)
defines provider flush and shutdown behavior. Configure exporter credentials and
collector endpoints in server environment variables. Keep those values out of
browser bundles, page data, and browser props.

## Keep runtime instrumentation replaceable

`defineOpenTelemetryInstrumentation` adapts OpenTelemetry to the
`RuntimeInstrumentation` contract. An application can continue to provide its
own `RuntimeInstrumentation` implementation when it uses another telemetry
system or a test recorder. Demiurge does not require the OpenTelemetry SDK to
serve requests.

The [observability example](../../examples/observability) shows spans, the
operation duration metric, trace propagation, and provider shutdown.
