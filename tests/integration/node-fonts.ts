import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve("examples/node-server");
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

const fontPath = "/_demiurge/font/inter-100-900-normal.woff2";

try {
  const origin = await waitForOrigin(child);
  const document = await fetch(`${origin}/`, {
    headers: { accept: "text/html" },
  });
  const html = await document.text();
  assertEqual(document.status, 200, "document status");
  assertIncludes(html, `href="${fontPath}"`, "font preload link");
  assertIncludes(html, 'href="/_demiurge/font/fonts.css"', "font stylesheet link");
  assertIncludes(
    document.headers.get("content-security-policy") ?? "",
    "font-src 'self'",
    "self-hosted font-src directive",
  );

  const stylesheet = await fetch(`${origin}/_demiurge/font/fonts.css`);
  const css = await stylesheet.text();
  assertEqual(stylesheet.status, 200, "font stylesheet status");
  assertEqual(
    stylesheet.headers.get("content-type"),
    "text/css; charset=utf-8",
    "font stylesheet content type",
  );
  assertIncludes(css, `url("${fontPath}")`, "self-hosted font face source");
  assertIncludes(css, "font-display: swap", "font display");

  const file = await fetch(`${origin}${fontPath}`);
  const served = new Uint8Array(await file.arrayBuffer());
  const source = new Uint8Array(
    await readFile(resolve(root, "fonts/inter-latin.woff2")),
  );
  assertEqual(file.status, 200, "font file status");
  assertEqual(
    file.headers.get("content-type"),
    "font/woff2",
    "font file content type",
  );
  assertEqual(served.byteLength, source.byteLength, "font file size");

  const revalidated = await fetch(`${origin}${fontPath}`, {
    headers: { "if-none-match": file.headers.get("etag") ?? "" },
  });
  await revalidated.arrayBuffer();
  assertEqual(revalidated.status, 304, "revalidated font status");

  const missing = await fetch(`${origin}/_demiurge/font/missing.woff2`);
  await missing.text();
  assertEqual(missing.status, 404, "unknown font status");

  console.log("node self-hosted font probe passed");
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

function assertIncludes(actual: string, expected: string, label: string) {
  if (!actual.includes(expected)) {
    throw new Error(`${label} omitted ${expected}.`);
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
      rejectOrigin(new Error(`Node server did not start. ${stderr}`));
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
      rejectOrigin(new Error(`Node server exited with code ${code}. ${stderr}`));
    });
  });
}
