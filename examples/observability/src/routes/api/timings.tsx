import { response, serverTiming, type ServerTimingMetric } from "@demiurgejs/core";

// Artificial delays stand in for real work: a database round trip and a
// cache lookup. The test suite checks that the measured duration for each
// step is at least this long. That proves the header carries real timing
// data, not a placeholder.
const databaseDelayMs = 40;
const cacheDelayMs = 8;

// json(...) and the other response helpers fix their `timing` option once,
// when the route module loads. That works for a metric a route always wants
// to report, but it cannot carry a duration measured during the current
// request. This route builds the Response itself with response(...) so it
// can measure each step and attach the header after the last one finishes.
export const GET = response(async () => {
  const database = await measure(
    "db",
    "simulated database query",
    () => simulateWork(databaseDelayMs, { rows: 3 }),
  );
  const cache = await measure(
    "cache",
    "simulated cache lookup",
    () => simulateWork(cacheDelayMs, { hit: true }),
  );

  const metrics = serverTiming(
    { description: database.description, duration: database.duration, name: database.name },
    { description: cache.description, duration: cache.duration, name: cache.name },
  );

  return Response.json(
    { cache: cache.value, database: database.value },
    { headers: { "server-timing": formatServerTiming(metrics) } },
  );
});

async function measure<T>(
  name: string,
  description: string,
  work: () => Promise<T>,
) {
  const start = performance.now();
  const value = await work();
  const duration = performance.now() - start;

  return { description, duration, name, value };
}

function simulateWork<T>(delayMs: number, value: T) {
  return new Promise<T>((resolve) => {
    setTimeout(() => resolve(value), delayMs);
  });
}

// Renders the same wire format the framework's own Server-Timing helpers
// produce, since only serverTiming(...) itself is public. See the header
// field grammar at https://www.w3.org/TR/server-timing/#the-server-timing-header-field.
function formatServerTiming(metrics: readonly ServerTimingMetric[]) {
  return metrics.map(formatServerTimingMetric).join(", ");
}

function formatServerTimingMetric(metric: ServerTimingMetric) {
  const parts = [metric.name];

  if (metric.duration !== undefined) {
    parts.push(`dur=${metric.duration}`);
  }

  if (metric.description !== undefined) {
    parts.push(`desc="${metric.description}"`);
  }

  return parts.join(";");
}
