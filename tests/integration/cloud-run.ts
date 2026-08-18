import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// This probe builds the real `examples/cloud-run` container image and runs
// it, the same way Cloud Run would. The app must bind whatever `$PORT` the
// platform hands it, not a hardcoded value. A Node-level check of `server.js`
// cannot prove the Dockerfile itself produces a working image, so this test
// shells out to a real `docker build` and `docker run`. `hasDocker` gates the
// probe instead of failing on a machine without the Docker daemon, mirroring
// the `redis-server` gate in `tests/integration/redis-cache-adapter.ts`.
const hasDocker = spawnSync("docker", ["info"]).status === 0;

if (!hasDocker) {
  console.log(
    "the Docker daemon is not reachable; skipping the cloud-run container probe.",
  );
  process.exit(0);
}

const repoRoot = resolve(".");
const imageTag = `demiurge-cloud-run-probe:${process.pid}`;
const containerName = `demiurge-cloud-run-probe-${process.pid}`;
// A port distinct from Cloud Run's conventional 8080 proves the image reads
// `$PORT` rather than assuming it.
const containerPort = 9000 + (process.pid % 500);
const hostPort = 24_000 + (process.pid % 5_000);

try {
  build();
  run();

  // `ALLOWED_HOSTS=localhost` below has no port, so it matches any port on
  // that hostname but rejects a request addressed to `127.0.0.1`.
  const origin = `http://localhost:${hostPort}`;
  await waitForReady(origin);

  const page = await fetch(origin, { headers: { accept: "text/html" } });

  if (!page.ok) {
    throw new Error(
      `Cloud Run container page request returned ${page.status}: ${await page.text()}`,
    );
  }

  const ready = await fetch(`${origin}/.well-known/ready`);

  if (!ready.ok) {
    throw new Error(
      `Cloud Run container readiness probe returned ${ready.status}: ${await ready.text()}`,
    );
  }

  console.log(
    `cloud-run container probe passed (host port ${hostPort} -> container $PORT ${containerPort})`,
  );
} finally {
  spawnSync("docker", ["rm", "-f", containerName]);
  spawnSync("docker", ["rmi", "-f", imageTag]);
}

function build() {
  const result = spawnSync(
    "docker",
    [
      "build",
      "-f",
      "examples/cloud-run/Dockerfile",
      "-t",
      imageTag,
      repoRoot,
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );

  if (result.status !== 0) {
    throw new Error(`docker build exited with code ${result.status}.`);
  }
}

function run() {
  const result = spawnSync("docker", [
    "run",
    "-d",
    "--rm",
    "--name",
    containerName,
    "-p",
    `${hostPort}:${containerPort}`,
    "-e",
    `PORT=${containerPort}`,
    "-e",
    "ALLOWED_HOSTS=localhost",
    imageTag,
  ]);

  if (result.status !== 0) {
    throw new Error(
      `docker run exited with code ${result.status}: ${result.stderr.toString("utf8")}`,
    );
  }
}

async function waitForReady(origin: string) {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/.well-known/ready`);

      if (response.ok) {
        return;
      }
    } catch {
      // The container may not accept connections yet. Retry until the deadline.
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }

  const logs = spawnSync("docker", ["logs", containerName]);
  throw new Error(
    `Cloud Run container did not become ready in time. ${logs.stdout?.toString("utf8") ?? ""} ${logs.stderr?.toString("utf8") ?? ""}`,
  );
}
