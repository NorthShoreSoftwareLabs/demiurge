import { spawn } from "node:child_process";
import { resolve } from "node:path";

// A macrotask timer is a minimum delay, not an exact one. The event loop can
// fire it a fraction of a millisecond early under real scheduling jitter, so
// this tolerates that instead of asserting a delay no real timer promises.
const timerJitterToleranceMs = 2;

const exampleRoot = resolve("examples/observability");
const child = spawn(process.execPath, ["server.js"], {
  cwd: exampleRoot,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    NODE_ENV: "production",
    PORT: "0",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

try {
  const origin = await waitForOrigin(child);

  const response = await fetch(`${origin}/api/timings`);
  const body = (await response.json()) as {
    cache: { hit: boolean };
    database: { rows: number };
  };
  const timingHeader = response.headers.get("server-timing");

  assertEqual(response.status, 200, "timings status");
  assertEqual(body.database.rows, 3, "database payload");
  assertEqual(body.cache.hit, true, "cache payload");

  if (!timingHeader) {
    throw new Error("Expected a server-timing header on the response.");
  }

  const metrics = parseServerTiming(timingHeader);

  assertAtLeast(metrics.db?.duration, 40, "db duration");
  assertAtLeast(metrics.cache?.duration, 8, "cache duration");
  assertEqual(
    metrics.db?.description,
    "simulated database query",
    "db description",
  );
  assertEqual(
    metrics.cache?.description,
    "simulated cache lookup",
    "cache description",
  );

  console.log(`observability probe passed with server-timing: ${timingHeader}`);
} finally {
  child.kill("SIGTERM");
  await new Promise<void>((resolveExit) => {
    if (child.exitCode !== null) {
      resolveExit();
      return;
    }

    child.once("exit", () => resolveExit());
  });
}

type ParsedMetric = {
  description?: string;
  duration?: number;
};

// A small, permissive reader for the header format described at
// https://www.w3.org/TR/server-timing/#the-server-timing-header-field. It
// only needs to recover what this example writes: name, dur, and desc.
function parseServerTiming(header: string): Record<string, ParsedMetric> {
  const metrics: Record<string, ParsedMetric> = {};

  for (const entry of header.split(",")) {
    const parts = entry.trim().split(";").map((part) => part.trim());
    const name = parts[0];

    if (!name) {
      continue;
    }

    const metric: ParsedMetric = {};

    for (const part of parts.slice(1)) {
      const durationMatch = /^dur=([\d.]+)$/.exec(part);
      const descriptionMatch = /^desc="(.*)"$/.exec(part);

      if (durationMatch) {
        metric.duration = Number(durationMatch[1]);
      } else if (descriptionMatch) {
        metric.description = descriptionMatch[1];
      }
    }

    metrics[name] = metric;
  }

  return metrics;
}

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(
      `${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
}

function assertAtLeast(actual: number | undefined, expected: number, label: string) {
  if (actual === undefined || actual < expected - timerJitterToleranceMs) {
    throw new Error(
      `${label} expected at least ${expected}, received ${JSON.stringify(actual)}.`,
    );
  }
}

function waitForOrigin(process: ReturnType<typeof spawn>) {
  return new Promise<string>((resolveOrigin, rejectOrigin) => {
    const timeout = setTimeout(() => {
      rejectOrigin(
        new Error(`Observability server did not start in time. ${stderr}`),
      );
    }, 10_000);

    process.stdout?.setEncoding("utf8");
    process.stdout?.on("data", (chunk: string) => {
      const match = /listening on (http:\/\/[^\s]+)/.exec(chunk);

      if (match) {
        clearTimeout(timeout);
        resolveOrigin(match[1]);
      }
    });
    process.once("exit", (code) => {
      clearTimeout(timeout);
      rejectOrigin(
        new Error(`Observability server exited with code ${code}. ${stderr}`),
      );
    });
  });
}
