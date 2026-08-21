import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const secret = "demo-webhook-secret";
// Irregular whitespace, duplicate keys, and non-ASCII text all survive a raw
// byte read. A handler that parsed this as JSON and re-serialized it before
// checking the signature would produce different bytes and a mismatch.
const body = '{"event":  "ping",\n  "note": "café  ✓", "event": "ping"}';
const signature = createHmac("sha256", secret).update(body).digest("hex");

const exampleRoot = resolve("examples/webhook-security");
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

  const validResponse = await fetch(`${origin}/api/webhook`, {
    body,
    headers: { "x-webhook-signature": `sha256=${signature}` },
    method: "POST",
  });
  const validPayload = (await validResponse.json()) as {
    byteLength: number;
    received: string;
  };

  assertEqual(validResponse.status, 200, "valid signature status");
  assertEqual(
    validPayload.received,
    body,
    "raw body round trip",
  );
  assertEqual(
    validPayload.byteLength,
    Buffer.byteLength(body, "utf8"),
    "raw body byte length",
  );

  const missingSignatureResponse = await fetch(`${origin}/api/webhook`, {
    body,
    method: "POST",
  });

  assertEqual(
    missingSignatureResponse.status,
    401,
    "missing signature status",
  );

  const badSignatureResponse = await fetch(`${origin}/api/webhook`, {
    body,
    headers: { "x-webhook-signature": "sha256=0000000000000000000000000000000000000000000000000000000000000000" },
    method: "POST",
  });

  assertEqual(badSignatureResponse.status, 401, "bad signature status");

  const tamperedBody = body.replace("ping", "pong");
  const tamperedResponse = await fetch(`${origin}/api/webhook`, {
    body: tamperedBody,
    headers: { "x-webhook-signature": `sha256=${signature}` },
    method: "POST",
  });

  assertEqual(tamperedResponse.status, 401, "tampered body status");

  console.log("webhook security probe passed");
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

function waitForOrigin(process: ReturnType<typeof spawn>) {
  return new Promise<string>((resolveOrigin, rejectOrigin) => {
    const timeout = setTimeout(() => {
      rejectOrigin(
        new Error(`Webhook security server did not start in time. ${stderr}`),
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
        new Error(`Webhook security server exited with code ${code}. ${stderr}`),
      );
    });
  });
}
