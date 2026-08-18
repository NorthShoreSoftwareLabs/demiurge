import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  unstable_formatStaticPolicyFindings,
  unstable_verifyRoutePolicySource,
} from "@demiurgejs/core/vite";

const clientOrigin = "http://localhost:42183";
const otherOrigin = "http://localhost:9999";

await assertWildcardCredentialsRejected();

const root = resolve("examples/cors-api");
const child = spawn(process.execPath, ["server.js"], {
  cwd: root,
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

  const greeting = await fetch(`${origin}/api/greeting`, {
    headers: { origin: clientOrigin },
  });
  assertEqual(greeting.status, 200, "greeting status");
  assertEqual(
    greeting.headers.get("access-control-allow-origin"),
    "*",
    "greeting allow-origin",
  );

  const preflight = await fetch(`${origin}/api/echo`, {
    method: "OPTIONS",
    headers: {
      "access-control-request-headers": "content-type, x-demo-token",
      "access-control-request-method": "POST",
      origin: clientOrigin,
    },
  });
  assertEqual(preflight.status, 204, "preflight status");
  assertEqual(
    preflight.headers.get("access-control-allow-origin"),
    clientOrigin,
    "preflight allow-origin",
  );
  assertEqual(
    preflight.headers.get("access-control-allow-credentials"),
    "true",
    "preflight allow-credentials",
  );
  assertEqual(
    preflight.headers.get("access-control-allow-methods"),
    "POST",
    "preflight allow-methods",
  );
  assertEqual(
    preflight.headers.get("access-control-allow-headers"),
    "content-type, x-demo-token",
    "preflight allow-headers",
  );

  const echo = await fetch(`${origin}/api/echo`, {
    method: "POST",
    body: JSON.stringify({ message: "hi" }),
    headers: {
      "content-type": "application/json",
      "x-demo-token": "server-probe",
      origin: clientOrigin,
    },
  });
  const echoBody = await echo.json();
  assertEqual(echo.status, 200, "echo status");
  assertEqual(
    echo.headers.get("access-control-allow-origin"),
    clientOrigin,
    "echo allow-origin",
  );
  assertEqual(
    echo.headers.get("x-demo-response-token"),
    "server-probe",
    "echo response token",
  );
  assertEqual(
    JSON.stringify(echoBody),
    JSON.stringify({
      echoed: { message: "hi" },
      receivedToken: "server-probe",
    }),
    "echo body",
  );

  // A request from an origin the policy does not list still reaches the
  // route. The server cannot know whether a caller enforces CORS at all. It
  // answers without an allow-origin header, so a real browser withholds the
  // response body from the calling page script.
  const denied = await fetch(`${origin}/api/echo`, {
    method: "POST",
    body: JSON.stringify({ message: "hi" }),
    headers: {
      "content-type": "application/json",
      "x-demo-token": "server-probe",
      origin: otherOrigin,
    },
  });
  assertEqual(denied.status, 200, "denied status");
  assertEqual(
    denied.headers.get("access-control-allow-origin"),
    null,
    "denied allow-origin",
  );

  console.log("cors-api probe passed");
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

// This mirrors the check the Vite plugin runs at build time. A route file
// that pairs a wildcard origin with credentials fails the same way here,
// before an application ever starts a dev server.
async function assertWildcardCredentialsRejected() {
  const source = `
import { json } from "@demiurgejs/core";
export const GET = json({ ok: true }, {
  cors: { credentials: true, origins: "*" },
});`;
  const findings = await unstable_verifyRoutePolicySource(
    source,
    "/app/src/routes/api/broken.ts",
  );

  if (findings.length === 0) {
    throw new Error(
      "Expected wildcard origins with credentials to fail static CORS verification.",
    );
  }

  let thrown: unknown;

  try {
    throw new Error(unstable_formatStaticPolicyFindings(findings));
  } catch (error) {
    thrown = error;
  }

  if (!(thrown instanceof Error) || !thrown.message.includes("cors-invalid")) {
    throw new Error(
      `Expected a cors-invalid build failure, received: ${String(thrown)}`,
    );
  }

  console.log("wildcard-plus-credentials rejection probe passed");
}

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(
      `${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
}

function waitForOrigin(process: ReturnType<typeof spawn>) {
  return new Promise<string>((resolveOrigin, rejectOrigin) => {
    const timeout = setTimeout(() => {
      rejectOrigin(new Error(`CORS API server did not start. ${stderr}`));
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
      rejectOrigin(new Error(`CORS API server exited with code ${code}. ${stderr}`));
    });
  });
}
