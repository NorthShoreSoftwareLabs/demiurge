import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:http";

// Playwright starts the entries of a `webServer` array one at a time. Its task
// runner awaits each plugin's setup before starting the next. Eight servers at
// roughly a second each cost eight seconds before the first test runs, and the
// array offers no concurrency option. So this launcher takes their place as a
// single `webServer` entry. It starts every server at once, waits for all of
// them, and only then opens `readyPort`, which is the URL Playwright polls.
// When that port answers, every server behind it is up.
const readyPort = 42_176;

const servers = [
  {
    args: ["--filter", "@demiurge-examples/node-server", "start"],
    env: { HOST: "localhost", NODE_ENV: "production", PORT: "42177" },
    name: "node-server",
    url: "http://localhost:42177/",
  },
  {
    args: [
      "--filter",
      "@demiurge-examples/static-export",
      "preview",
      "--host",
      "localhost",
      "--port",
      "42178",
    ],
    env: {},
    name: "static-export",
    url: "http://localhost:42178/",
  },
  {
    args: [
      "--filter",
      "@demiurge-examples/ssr-page",
      "dev",
      "--host",
      "localhost",
      "--port",
      "42179",
    ],
    env: {},
    name: "ssr-page",
    url: "http://localhost:42179/",
  },
  {
    args: ["--filter", "@demiurge-examples/sse-feed", "start"],
    env: { HOST: "localhost", NODE_ENV: "production", PORT: "42180" },
    name: "sse-feed",
    url: "http://localhost:42180/",
  },
  {
    args: ["--filter", "@demiurge-examples/conditional-script", "start"],
    env: { HOST: "localhost", NODE_ENV: "production", PORT: "42181" },
    name: "conditional-script",
    url: "http://localhost:42181/",
  },
  {
    args: ["--filter", "@demiurge-examples/analytics-csp", "start"],
    env: { HOST: "localhost", NODE_ENV: "production", PORT: "42184" },
    name: "analytics-csp",
    url: "http://localhost:42184/",
  },
  {
    args: ["--filter", "@demiurge-examples/cors-api", "start"],
    env: { HOST: "localhost", NODE_ENV: "production", PORT: "42182" },
    name: "cors-api",
    url: "http://localhost:42182/",
  },
  {
    args: ["--filter", "@demiurge-examples/cors-api", "start:client"],
    env: { HOST: "localhost", PORT: "42183" },
    name: "cors-api-client",
    url: "http://localhost:42183/",
  },
];

const bootTimeoutMs = 90_000;
const pollIntervalMs = 100;
const children: ChildProcess[] = [];
let shuttingDown = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    shutdown();
    process.exit(0);
  });
}

try {
  // `reuseExistingServer: false` in the Playwright config only guards the
  // readiness gate now, so the eight real ports are checked here instead. A
  // stray server left over from an interrupted run would otherwise answer the
  // readiness poll and the suite would silently test yesterday's build.
  await assertPortsAreFree();
  await Promise.all(servers.map((server) => start(server)));
} catch (error) {
  shutdown();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("ready");
}).listen(readyPort, "localhost", () => {
  console.log(
    `all ${servers.length} browser-test servers are up; readiness gate on http://localhost:${readyPort}/`,
  );
});

async function assertPortsAreFree() {
  const taken = await Promise.all(
    [...servers.map((server) => server.url), `http://localhost:${readyPort}/`].map(
      async (url) => {
        try {
          await fetch(url);
          return url;
        } catch {
          return undefined;
        }
      },
    ),
  );
  const occupied = taken.filter((url) => url !== undefined);

  if (occupied.length > 0) {
    throw new Error(
      `Something is already listening on ${occupied.join(", ")}. Stop it and run the browser tests again.`,
    );
  }
}

async function start(server: (typeof servers)[number]) {
  // Deliberately not `detached`. Playwright tears a `webServer` down with
  // `process.kill(-pid, "SIGKILL")` on this launcher's process group. SIGKILL
  // cannot be handled, so these servers must sit in that same group to die
  // with the suite. Detaching them leaves eight servers holding their ports.
  const child = spawn("pnpm", server.args, {
    env: { ...process.env, ...server.env, FORCE_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  children.push(child);

  let ready = false;
  const exited = new Promise<never>((_resolve, rejectExit) => {
    child.once("exit", (code) => {
      if (ready) {
        // Expected: this is the shutdown path. Nothing is racing this promise
        // any more, so a rejection here would surface as an unhandled one.
        return;
      }

      rejectExit(
        new Error(`${server.name} exited with code ${code} before it was ready.`),
      );
    });
  });

  // Server logs stay on this process's stdio so Playwright still surfaces them
  // under its `[WebServer]` prefix when a boot goes wrong.
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk: string) => process.stderr.write(chunk));

  await Promise.race([exited, waitForUrl(server.name, server.url)]);
  ready = true;
  console.log(`${server.name} is ready on ${server.url}`);
}

async function waitForUrl(name: string, url: string) {
  const deadline = Date.now() + bootTimeoutMs;

  for (;;) {
    try {
      // Any answer proves something is listening and speaking HTTP, which is
      // the same bar Playwright's own `webServer` readiness check applies.
      await fetch(url);
      return;
    } catch {
      if (Date.now() > deadline) {
        throw new Error(`${name} did not answer ${url} within ${bootTimeoutMs}ms.`);
      }

      await new Promise((resolveDelay) => setTimeout(resolveDelay, pollIntervalMs));
    }
  }
}

function shutdown() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  // This path only covers a boot failure and a plain Ctrl-C. Playwright's own
  // teardown never reaches here, because it SIGKILLs the process group.
  for (const child of children) {
    child.kill("SIGTERM");
  }
}
