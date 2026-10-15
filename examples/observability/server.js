import console from "node:console";
import process from "node:process";
import { defineOpenTelemetryInstrumentation } from "@demiurgejs/core/opentelemetry";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  ConsoleMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { serveNodeBuild } from "@demiurgejs/core/node";
import { createHandler } from "./dist/server/server-entry.js";

const tracerProvider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
});
const meterProvider = new MeterProvider({
  readers: [
    new PeriodicExportingMetricReader({
      exporter: new ConsoleMetricExporter(),
      exportIntervalMillis: 2_000,
    }),
  ],
});
const instrumentation = defineOpenTelemetryInstrumentation({
  meter: meterProvider.getMeter("demiurge-observability-example"),
  propagator: new W3CTraceContextPropagator(),
  tracer: tracerProvider.getTracer("demiurge-observability-example"),
});

let server;
try {
  server = await serveNodeBuild({
    base: import.meta.url,
    createHandler: ({ page }) => createHandler({ ...page, runtimeInstrumentation: instrumentation }),
    name: "Demiurge observability server",
    port: 4211,
    runtimeInstrumentation: instrumentation,
    shutdown: { signals: [] },
  });
} catch (error) {
  await Promise.allSettled([
    tracerProvider.shutdown(),
    meterProvider.shutdown(),
  ]);
  throw error;
}

let shutdownPromise;
const shutdown = () => {
  if (shutdownPromise) return shutdownPromise;

  shutdownPromise = (async () => {
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

    if (failures.length) {
      console.error("Demiurge observability telemetry shutdown failed.",
        new AggregateError(failures, "Shutdown failed."));
      process.exitCode = 1;
    }
  })();

  return shutdownPromise;
};

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void shutdown();
  });
}
