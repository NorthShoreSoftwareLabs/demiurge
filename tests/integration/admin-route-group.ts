import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve("examples/admin-route-group");
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

  const dashboardResponse = await fetch(`${origin}/dashboard`, {
    headers: { accept: "text/html" },
    redirect: "manual",
  });

  assertEqual(dashboardResponse.status, 302, "dashboard redirect status");
  assertIncludes(
    dashboardResponse.headers.get("location") ?? "",
    "/login?from=%2Fdashboard",
    "dashboard redirect target",
  );

  const settingsResponse = await fetch(`${origin}/settings`, {
    headers: { accept: "text/html" },
    redirect: "manual",
  });

  assertEqual(settingsResponse.status, 302, "settings redirect status");
  assertIncludes(
    settingsResponse.headers.get("location") ?? "",
    "/login?from=%2Fsettings",
    "settings redirect target",
  );

  const loginResponse = await fetch(`${origin}/login?from=%2Fdashboard`, {
    body: "",
    method: "POST",
    redirect: "manual",
  });
  const sessionCookie = (loginResponse.headers.get("set-cookie") ?? "").split(
    ";",
  )[0];

  assertEqual(loginResponse.status, 303, "login status");
  assertEqual(sessionCookie, "session=1", "login session cookie");
  assertEqual(
    loginResponse.headers.get("location"),
    "/dashboard",
    "login redirect target",
  );

  const dashboardWithSession = await fetch(`${origin}/dashboard`, {
    headers: { accept: "text/html", cookie: sessionCookie },
  });
  const dashboardDocument = await dashboardWithSession.text();

  assertEqual(dashboardWithSession.status, 200, "authenticated dashboard status");
  assertIncludes(dashboardDocument, "Dashboard", "authenticated dashboard document");
  assertIncludes(dashboardDocument, "admin-shell", "authenticated dashboard shell");

  const settingsWithSession = await fetch(`${origin}/settings`, {
    headers: { accept: "text/html", cookie: sessionCookie },
  });
  const settingsDocument = await settingsWithSession.text();

  assertEqual(settingsWithSession.status, 200, "authenticated settings status");
  assertIncludes(settingsDocument, "Settings", "authenticated settings document");
  assertIncludes(settingsDocument, "admin-shell", "authenticated settings shell");

  console.log("admin route group probe passed");
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
      rejectOrigin(new Error(`Admin route group server did not start. ${stderr}`));
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
      rejectOrigin(new Error(`Admin route group server exited with code ${code}. ${stderr}`));
    });
  });
}
