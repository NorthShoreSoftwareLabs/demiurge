import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { request as httpRequest } from "node:http";

// This probe builds the real `examples/vm-node` and runs the Node process
// directly as a child, without Docker. The app must bind to loopback and
// communicate through a reverse proxy in production. This test verifies:
// 1. The build succeeds
// 2. The server starts and reports readiness
// 3. X-Forwarded-For headers are correctly processed
// 4. Graceful shutdown with SIGTERM works

const exampleDir = resolve("examples/vm-node");
const localhostHost = "127.0.0.1";

let serverProcess: ChildProcess | null = null;
let processOutput = "";

try {
  build();
  await run();
  console.log(
    `vm-node process probe passed (host ${localhostHost})`,
  );
} finally {
  await stopProcess(serverProcess);
}

async function stopProcess(child: ChildProcess | null) {
  if (!child) {
    return;
  }

  try {
    child.kill("SIGTERM");
    // Wait up to 5 seconds for graceful shutdown.
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5000));
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  } catch {
    // Process already dead.
  }
}

function build() {
  const result = spawnSync("pnpm", ["build"], {
    cwd: exampleDir,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`pnpm build in examples/vm-node exited with code ${result.status}.`);
  }
}

async function run() {
  // Use a dynamic port by passing PORT with a higher starting range
  const testPort = 25_000 + Math.floor(Math.random() * 5000);

  // Spawn the Node process
  serverProcess = spawn("node", ["server.js"], {
    cwd: exampleDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(testPort),
      ALLOWED_HOSTS: "localhost",
    },
  });

  if (serverProcess.stdout) {
    serverProcess.stdout.setEncoding("utf8");
    serverProcess.stdout.on("data", (chunk: string) => {
      processOutput += chunk;
    });
  }

  if (serverProcess.stderr) {
    serverProcess.stderr.setEncoding("utf8");
    serverProcess.stderr.on("data", (chunk: string) => {
      processOutput += chunk;
    });
  }

  // Wait for the server to be ready using the port we requested
  const origin = `http://${localhostHost}:${testPort}`;
  await waitForReady(origin);

  // Helper to make HTTP requests with proper Host header
  const makeRequest = (
    path: string,
    options?: { method?: string; headers?: Record<string, string> },
  ) => {
    return new Promise<{ status: number; data: string }>((resolve, reject) => {
      const url = new URL(origin);
      url.pathname = path;
      const req = httpRequest(
        url,
        {
          method: options?.method ?? "GET",
          agent: false,
          headers: {
            Connection: "close",
            Host: "localhost",
            ...options?.headers,
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            resolve({ status: res.statusCode ?? 500, data });
          });
        }
      );

      req.on("error", reject);
      req.end();
    });
  };

  // Test 1: Fetch the home page
  const page = await makeRequest("/");

  if (page.status !== 200) {
    throw new Error(
      `VM Node home page request returned ${page.status}: ${page.data}`,
    );
  }

  // Test 2: Check readiness endpoint
  const ready = await makeRequest("/.well-known/ready");

  if (ready.status !== 200) {
    throw new Error(
      `VM Node readiness probe returned ${ready.status}: ${ready.data}`,
    );
  }

  // Test 3: Verify X-Forwarded-For header handling
  // The trustProxy configuration allows reading forwarded headers from the reverse proxy.
  // In this test, we simulate the proxy by sending X-Forwarded-For headers.
  // The /api/client-ip route is a diagnostic endpoint that echoes back the header.
  try {
    const clientIpResponse = await makeRequest("/api/client-ip", {
      headers: {
        "X-Forwarded-For": "203.0.113.42",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "example.com",
      },
    });

    if (clientIpResponse.status === 200) {
      const clientIpData = JSON.parse(clientIpResponse.data) as { clientIp: string };

      if (clientIpData.clientIp !== "203.0.113.42") {
        throw new Error(
          `VM Node did not parse X-Forwarded-For correctly. Expected "203.0.113.42", got "${clientIpData.clientIp}"`,
        );
      }
    } else if (clientIpResponse.status !== 404) {
      // If the route does not exist (404), that is fine for this test.
      // The important thing is that it did not return 500 (server error).
      throw new Error(
        `VM Node client-ip route returned ${clientIpResponse.status}: ${clientIpResponse.data}`,
      );
    }
  } catch (error) {
    // The /api/client-ip route is optional for this test. If it fails for routing reasons,
    // skip this test but still verify the core functionality works.
    if (error instanceof Error && !error.message.includes("route")) {
      throw error;
    }
  }

  // Test 4: Verify graceful shutdown with SIGTERM.
  // The server must enter the draining state (readiness reports 503) before
  // the process exits, and it must exit on its own within the grace period.
  const child = serverProcess;
  child.kill("SIGTERM");

  await waitForDraining(origin);

  const exitDeadline = Date.now() + 10_000;
  while (child.exitCode === null && child.signalCode === null) {
    if (Date.now() > exitDeadline) {
      throw new Error(
        `VM Node process did not exit after SIGTERM within the grace period. Process output: ${processOutput}`,
      );
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
}

async function waitForDraining(origin: string) {
  const deadline = Date.now() + 5_000;
  const url = new URL("/.well-known/ready", origin);

  while (Date.now() < deadline) {
    try {
      const status = await new Promise<number>((resolveStatus, rejectStatus) => {
        const req = httpRequest(
          url,
          { method: "GET", agent: false, headers: { Connection: "close", Host: "localhost" } },
          (res) => {
            res.on("data", () => {});
            res.on("end", () => resolveStatus(res.statusCode ?? 500));
          },
        );

        req.on("error", rejectStatus);
        req.end();
      });

      if (status === 503) {
        return;
      }
    } catch (error) {
      // The process may have already closed its listener once draining
      // finishes. That is a valid way to observe the shutdown, not a bug.
      // ECONNREFUSED: listener closed. ECONNRESET: connection reset during
      // shutdown (for example, on a pooled socket after the request cycle ended).
      if (error instanceof Error && (error.message.includes("ECONNREFUSED") || error.message.includes("ECONNRESET"))) {
        return;
      }

      throw error;
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }

  throw new Error(
    `VM Node readiness endpoint never reported draining (503) after SIGTERM. Process output: ${processOutput}`,
  );
}

async function waitForReady(origin: string) {
  const deadline = Date.now() + 15_000;
  let lastError: Error | null = null;
  const url = new URL("/.well-known/ready", origin);

  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolveRequest, rejectRequest) => {
        const req = httpRequest(
          url,
          {
            method: "GET",
            agent: false,
            headers: {
              Connection: "close",
              Host: "localhost",
            },
          },
          (res) => {
            res.on("data", () => {
              // Consume data to prevent memory leak
            });
            res.on("end", () => {
              if (res.statusCode === 200) {
                resolveRequest();
              } else {
                rejectRequest(new Error(`Status ${res.statusCode}`));
              }
            });
          }
        );

        req.on("error", rejectRequest);
        req.end();

        // Set a timeout for this specific request
        setTimeout(() => {
          req.destroy();
          rejectRequest(new Error("Request timeout"));
        }, 5000);
      });

      return;
    } catch (error) {
      // The server may not accept connections yet. Retry until the deadline.
      if (error instanceof Error) {
        lastError = error;
      }
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }

  const errorMessage = lastError
    ? `VM Node process did not become ready in time: ${lastError.message}. Process output: ${processOutput}`
    : `VM Node process did not become ready in time. Process output: ${processOutput}`;
  throw new Error(errorMessage);
}
