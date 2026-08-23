import { spawn } from "node:child_process";
import { resolve } from "node:path";

const child = spawn(process.execPath, ["server.js"], {
  cwd: resolve("examples/form-interoperability"),
  env: { ...process.env, HOST: "127.0.0.1", NODE_ENV: "production", PORT: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { stderr += chunk; });

try {
  const origin = await waitForOrigin(child);
  const initial = await fetch(`${origin}/`, { headers: { accept: "text/html" } });
  const initialHtml = await initial.text();
  if (!/Saved submissions:.*0/.test(initialHtml)) {
    throw new Error("The initial form page did not render the current submission count.");
  }

  const invalid = await post(origin, { email: "invalid", message: "short" });
  if (invalid.status !== 422) {
    throw new Error(`Invalid form data returned ${invalid.status}, not 422.`);
  }

  const valid = await post(origin, {
    email: "person@example.com",
    message: "A progressively enhanced message.",
  });
  if (valid.status !== 303 || valid.headers.get("location") !== "/?saved=1") {
    throw new Error(`Valid form data returned ${valid.status} without the expected redirect.`);
  }

  const updated = await fetch(`${origin}/?saved=1`, { headers: { accept: "text/html" } });
  const updatedHtml = await updated.text();
  if (!/Saved submissions:.*1/.test(updatedHtml) || !updatedHtml.includes("A progressively enhanced message.")) {
    throw new Error("The redirected page did not revalidate the saved feedback.");
  }
  console.log("form interoperability probe passed");
} finally {
  child.kill("SIGTERM");
  await new Promise<void>((done) => {
    if (child.exitCode !== null) done();
    else child.once("exit", () => done());
  });
  if (child.exitCode && stderr) console.error(stderr);
}

async function post(origin: string, values: Record<string, string>) {
  return await fetch(`${origin}/api/feedback`, {
    body: new URLSearchParams(values),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
    redirect: "manual",
  });
}

function waitForOrigin(process: ReturnType<typeof spawn>) {
  return new Promise<string>((resolveOrigin, rejectOrigin) => {
    const timeout = setTimeout(() => rejectOrigin(new Error(`Example did not start. ${stderr}`)), 10_000);
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
      rejectOrigin(new Error(`Example exited with code ${code}. ${stderr}`));
    });
  });
}
