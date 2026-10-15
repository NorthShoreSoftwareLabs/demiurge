import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const serverSource = ts.createSourceFile(
  "server.js",
  readFileSync(new URL("../examples/observability/server.js", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
const serverBody = serverSource.statements
  .filter((statement) => !ts.isImportDeclaration(statement))
  .map((statement) => statement.getText(serverSource))
  .join("\n")
  .replace("import.meta.url", '"file:///example/server.js"');

type Operation = () => void | Promise<void>;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => { resolve = finish; });
  return { promise, resolve };
}

async function loadShutdown(operations: readonly Operation[]) {
  const errors: AggregateError[] = [];
  const process = { exitCode: 0, once() {} };
  const shutdown: () => Promise<void> = await runInNewContext(
    `(async () => { ${serverBody}\n return shutdown; })()`,
    {
      AggregateError,
      Promise,
      console: { error: (_message: string, error: AggregateError) => errors.push(error) },
      process,
      defineOpenTelemetryInstrumentation: () => ({}),
      W3CTraceContextPropagator: class {},
      ConsoleMetricExporter: class {},
      PeriodicExportingMetricReader: class {},
      ConsoleSpanExporter: class {},
      SimpleSpanProcessor: class {},
      NodeTracerProvider: class {
        getTracer() { return {}; }
        forceFlush = operations[1];
        shutdown = operations[3];
      },
      MeterProvider: class {
        getMeter() { return {}; }
        forceFlush = operations[2];
        shutdown = operations[4];
      },
      serveNodeBuild: () => ({ shutdown: operations[0] }),
      createHandler: () => ({}),
    },
  );
  return { shutdown, errors, process };
}

for (const failedFlush of [1, 2]) {
  void test(`shutdown waits for the other flush when operation ${failedFlush} rejects`, async () => {
    const calls: number[] = [];
    const failure = new Error("Flush failed.");
    const pending = deferred();
    const flushStarted = deferred();
    const operations = Array.from({ length: 5 }, (_, index): Operation => () => {
      calls.push(index);
      if (index === failedFlush) return Promise.reject(failure);
      if (index === 3 - failedFlush) {
        flushStarted.resolve();
        return pending.promise;
      }
    });
    const { shutdown, errors, process } = await loadShutdown(operations);
    const completion = shutdown();
    assert.equal(shutdown(), completion);
    await flushStarted.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, [0, 1, 2]);
    assert.equal(errors.length, 0);
    pending.resolve();
    await completion;
    assert.deepEqual(calls, [0, 1, 2, 3, 4]);
    assert.deepEqual(errors[0]?.errors, [failure]);
    assert.equal(process.exitCode, 1);
    await shutdown();
    assert.deepEqual(calls, [0, 1, 2, 3, 4]);
  });
}

void test("shutdown attempts every operation after synchronous failures", async () => {
  const calls: number[] = [];
  const failures = Array.from({ length: 5 }, (_, index) => new Error(`Operation ${index} failed.`));
  const operations = failures.map((failure, index): Operation => () => {
    calls.push(index);
    throw failure;
  });
  const { shutdown, errors, process } = await loadShutdown(operations);
  await shutdown();
  assert.deepEqual(calls, [0, 1, 2, 3, 4]);
  assert.deepEqual(errors[0]?.errors, failures);
  assert.equal(process.exitCode, 1);
});

void test("shutdown completes once without a failure report", async () => {
  const calls: number[] = [];
  const operations = Array.from({ length: 5 }, (_, index): Operation => () => {
    calls.push(index);
  });
  const { shutdown, errors, process } = await loadShutdown(operations);
  await Promise.all([shutdown(), shutdown()]);
  assert.deepEqual(calls, [0, 1, 2, 3, 4]);
  assert.deepEqual(errors, []);
  assert.equal(process.exitCode, 0);
});
