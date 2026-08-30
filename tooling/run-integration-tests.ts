import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";

// Every probe in `tests/integration` owns its own world. Each spawns its own
// server on `PORT=0`, so the operating system hands it a free port. The two
// probes needing more than a port derive their names from `process.pid`.
// `redis-cache-adapter` derives its Redis port that way, and `cloud-run` its
// image tag, container name, and host port. No probe takes a fixed port or
// writes a shared file, so they can all run at once.
const probes = [
  // The Docker build and container run make this the longest probe. Start it
  // first and let the cheap ones fill the remaining lanes beside it.
  "tests/integration/cloud-run.ts",
  "tests/integration/vm-node.ts",
  "tests/integration/runtime-server-data.ts",
  "tests/integration/app-owned-fallbacks.ts",
  "tests/integration/nested-policies.ts",
  "tests/integration/metadata-blog.ts",
  "tests/integration/node-images.ts",
  "tests/integration/node-fonts.ts",
  "tests/integration/admin-route-group.ts",
  "tests/integration/redis-cache-adapter.ts",
  "tests/integration/webhook-security.ts",
  "tests/integration/cache-invalidation.ts",
  "tests/integration/cors-api.ts",
  "tests/integration/analytics-csp.ts",
  "tests/integration/observability.ts",
  "tests/integration/form-interoperability.ts",
];

// Each probe is mostly idle, waiting on a server to boot and on HTTP round
// trips. A lane count near the core count still buys wall clock. The cap keeps
// a laptop from swapping under a Node process per probe.
const laneCount = Math.max(2, Math.min(8, availableParallelism()));

type ProbeResult = {
  code: number | null;
  output: string;
  probe: string;
};

const queue = [...probes].reverse();
const results: ProbeResult[] = [];

await Promise.all(
  Array.from({ length: Math.min(laneCount, queue.length) }, async () => {
    for (let probe = queue.pop(); probe; probe = queue.pop()) {
      results.push(await runProbe(probe));
    }
  }),
);

const failures = results.filter((result) => result.code !== 0);

for (const failure of failures) {
  console.error(`\n--- ${failure.probe} failed (exit code ${failure.code}) ---`);
  console.error(failure.output.trimEnd());
}

if (failures.length > 0) {
  console.error(
    `\n${failures.length} of ${probes.length} integration probes failed.`,
  );
  process.exitCode = 1;
} else {
  console.log(`All ${probes.length} integration probes passed.`);
}

// Probe output is buffered rather than inherited. Fourteen probes writing to
// one terminal at once interleaves into noise, and a passing probe's log is
// only worth reading when the probe fails.
function runProbe(probe: string) {
  return new Promise<ProbeResult>((resolveResult, rejectResult) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", probe],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      output += chunk;
    });
    child.once("error", rejectResult);
    child.once("close", (code) => {
      console.log(`${code === 0 ? "pass" : "FAIL"}  ${probe}`);
      resolveResult({ code, output, probe });
    });
  });
}
