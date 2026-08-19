import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  analytics,
  defineRoutePolicy,
  defineScripts,
  mergeRoutePolicies,
  page,
  security,
  validateRouteModules,
  type RouteModule,
} from "@demiurgejs/core";

const plausible = analytics.plausible({
  domain: "analytics-csp.example",
  endpoint: "https://plausible.example.com",
});

assertMissingScriptDirectiveRejected();
assertMissingBeaconDirectiveRejected();
assertWiredIntegrationAccepted();

const root = resolve("examples/analytics-csp");
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
  const home = await fetch(origin);
  const html = await home.text();
  const policy = home.headers.get("content-security-policy") ?? "";

  assertEqual(home.status, 200, "home status");

  // The integration never emits an inline snippet, so the policy that serves
  // it has no reason to carry an unsafe-inline source.
  if (policy.includes("'unsafe-inline'")) {
    throw new Error(`Expected no unsafe-inline source, received ${policy}.`);
  }

  if (!policy.includes("connect-src 'self'")) {
    throw new Error(`Expected a connect-src directive, received ${policy}.`);
  }

  const tag = /<script[^>]*src="\/stats\/js\/script\.js"[^>]*>/.exec(html)?.[0];

  if (!tag) {
    throw new Error("Expected the proxied analytics script tag in the document.");
  }

  if (!/nonce="[^"]+"/.test(tag)) {
    throw new Error(`Expected a framework nonce on the script tag, received ${tag}.`);
  }

  if (!tag.includes('data-api="/stats/api/event"')) {
    throw new Error(`Expected the vendor API attribute, received ${tag}.`);
  }

  const beacon = await fetch(`${origin}/stats/api/event`, {
    body: JSON.stringify({ n: "pageview" }),
    headers: { "content-type": "text/plain" },
    method: "POST",
  });
  assertEqual(beacon.status, 202, "beacon status");

  console.log("analytics-csp probe passed");
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

// A route that contributes the vendor script but keeps the inherited policy
// fails before the server accepts traffic. This mirrors the CORS rejection
// probe, which proves the same boundary for a route response policy.
function assertMissingScriptDirectiveRejected() {
  assertThrows(
    () =>
      validateRouteModules(analyticsRoutes({
        policy: defineRoutePolicy({ document: security.static() }),
      })),
    "violates the effective script-src",
    "missing script-src rejection",
  );

  console.log("missing script-src rejection probe passed");
}

// Widening script-src alone leaves the vendor beacon blocked. The diagnostic
// names connect-src and the origin, so the fix does not need a browser.
function assertMissingBeaconDirectiveRejected() {
  assertThrows(
    () =>
      validateRouteModules(analyticsRoutes({
        policy: defineRoutePolicy({
          document: security.static(),
          security: { needs: { script: ["https://plausible.example.com"] } },
        }),
      })),
    "needs connect-src https://plausible.example.com",
    "missing connect-src rejection",
  );

  console.log("missing connect-src rejection probe passed");
}

function assertWiredIntegrationAccepted() {
  validateRouteModules(analyticsRoutes({
    policy: mergeRoutePolicies(
      { document: security.static() },
      analytics.policy(plausible),
    ),
  }));

  console.log("wired integration acceptance probe passed");
}

function analyticsRoutes(policyModule: RouteModule) {
  return {
    "./routes/@policy.ts": policyModule,
    "./routes/index.tsx": {
      GET: page({ render: { mode: "ssr" }, view: () => null }),
      scripts: defineScripts(analytics.scripts(plausible)),
    },
  } satisfies Record<string, RouteModule>;
}

function assertThrows(run: () => void, expected: string, label: string) {
  let thrown: unknown;

  try {
    run();
  } catch (error) {
    thrown = error;
  }

  if (!(thrown instanceof Error)) {
    throw new Error(`${label} expected a build failure, received none.`);
  }

  if (!thrown.message.includes(expected)) {
    throw new Error(
      `${label} expected a message containing ${JSON.stringify(expected)}, received ${thrown.message}`,
    );
  }
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
      rejectOrigin(new Error(`Analytics CSP server did not start. ${stderr}`));
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
      rejectOrigin(new Error(`Analytics CSP server exited with code ${code}. ${stderr}`));
    });
  });
}
