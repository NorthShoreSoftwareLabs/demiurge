import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve("examples/nested-policies");
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
  const rootResponse = await fetch(`${origin}/`, {
    headers: { accept: "text/html" },
  });
  const rootDocument = await rootResponse.text();
  const rootCsp = rootResponse.headers.get("content-security-policy") ?? "";

  assertEqual(rootResponse.status, 200, "root status");
  assertIncludes(rootDocument, "Shared security defaults", "root document");
  assertIncludes(rootCsp, "https://api.example.com", "root CSP");
  assertEqual(
    rootResponse.headers.get("referrer-policy"),
    "strict-origin-when-cross-origin",
    "root referrer policy",
  );

  const adminResponse = await fetch(`${origin}/admin`, {
    headers: { accept: "text/html" },
  });
  const adminDocument = await adminResponse.text();
  const adminCsp = adminResponse.headers.get("content-security-policy") ?? "";

  assertEqual(adminResponse.status, 200, "admin status");
  assertIncludes(adminDocument, "Tightened admin policy", "admin document");
  if (adminCsp.includes("https://api.example.com")) {
    throw new Error("Admin CSP must remove the root API origin.");
  }
  assertIncludes(adminCsp, "connect-src 'self'", "admin CSP");
  assertEqual(
    adminResponse.headers.get("referrer-policy"),
    "no-referrer",
    "admin referrer policy",
  );

  console.log("nested policies probe passed");
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
      rejectOrigin(new Error(`Nested policies server did not start. ${stderr}`));
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
      rejectOrigin(new Error(`Nested policies server exited with code ${code}. ${stderr}`));
    });
  });
}
