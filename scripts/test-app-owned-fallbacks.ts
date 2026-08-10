import { spawn } from "node:child_process";
import { resolve } from "node:path";

const exampleRoot = resolve("examples/app-owned-fallbacks");
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

  await assertDocument(origin, "/missing", {
    includes: [
      'data-fallback-owner="root-not-found"',
      'data-layout-owner="root"',
    ],
    omits: ['data-layout-owner="projects"'],
    status: 404,
  });
  await assertDocument(origin, "/projects/missing", {
    includes: [
      'data-fallback-owner="projects-not-found"',
      'data-layout-owner="root"',
      'data-layout-owner="projects"',
    ],
    omits: ['data-fallback-owner="root-not-found"'],
    status: 404,
  });
  await assertDocument(origin, "/broken", {
    includes: ['data-fallback-owner="root-error"'],
    omits: [
      "Deliberate root render secret.",
      'data-layout-owner="root"',
    ],
    status: 500,
  });
  await assertDocument(origin, "/projects/broken", {
    includes: ['data-fallback-owner="projects-error"', ">503<"],
    omits: [
      "Deliberate project render failure.",
      'data-fallback-owner="root-error"',
      'data-layout-owner="root"',
      'data-layout-owner="projects"',
    ],
    status: 503,
  });

  const apiResponse = await fetch(`${origin}/api/broken`, {
    headers: { accept: "application/json" },
  });
  assertEqual(apiResponse.status, 409, "API status");
  assertIncludes(
    apiResponse.headers.get("content-type") ?? "",
    "application/problem+json",
    "API content type",
  );
  const problem = await apiResponse.json() as Record<string, unknown>;
  assertEqual(problem.status, 409, "problem status");
  assertEqual(problem.title, "Project Revision Conflict", "problem title");
  assertEqual(problem.instance, "/api/broken", "problem instance");
  assertEqual(
    problem.code,
    "PROJECT_REVISION_CONFLICT",
    "problem extension",
  );

  console.log("app-owned fallbacks probe passed");
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

async function assertDocument(
  origin: string,
  pathname: string,
  expected: {
    includes: string[];
    omits: string[];
    status: number;
  },
) {
  const response = await fetch(`${origin}${pathname}`, {
    headers: { accept: "text/html" },
  });
  const document = await response.text();

  assertEqual(response.status, expected.status, `${pathname} status`);
  assertIncludes(
    response.headers.get("content-type") ?? "",
    "text/html",
    `${pathname} content type`,
  );

  for (const value of expected.includes) {
    assertIncludes(document, value, `${pathname} document`);
  }

  for (const value of expected.omits) {
    if (document.includes(value)) {
      throw new Error(`${pathname} document unexpectedly included ${value}.`);
    }
  }
}

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(
      `${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
}

function assertIncludes(actual: string, expected: string, label: string) {
  if (!actual.includes(expected)) {
    throw new Error(`${label} omitted ${expected}.`);
  }
}

function waitForOrigin(process: ReturnType<typeof spawn>) {
  return new Promise<string>((resolveOrigin, rejectOrigin) => {
    const timeout = setTimeout(() => {
      rejectOrigin(
        new Error(`Fallback example server did not start in time. ${stderr}`),
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
        new Error(`Fallback example server exited with code ${code}. ${stderr}`),
      );
    });
  });
}
