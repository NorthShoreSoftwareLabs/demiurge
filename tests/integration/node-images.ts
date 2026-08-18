import { spawn } from "node:child_process";
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

try {
  const origin = await waitForOrigin(child);
  const document = await fetch(`${origin}/hero`, {
    headers: { accept: "text/html" },
  });
  const html = await document.text();
  assertEqual(document.status, 200, "hero document status");
  assertIncludes(
    html,
    "/_demiurge/image?src=%2Fhero.png&amp;w=600&amp;q=72",
    "hero optimizer URL",
  );

  const source = await fetch(`${origin}/hero.png`);
  const sourceBytes = (await source.arrayBuffer()).byteLength;
  assertEqual(source.status, 200, "source image status");

  const webp = await fetch(`${origin}/_demiurge/image?src=%2Fhero.png&w=600&q=72`, {
    headers: { accept: "image/webp,*/*" },
  });
  const webpBytes = (await webp.arrayBuffer()).byteLength;
  assertEqual(webp.status, 200, "optimized image status");
  assertEqual(
    webp.headers.get("content-type"),
    "image/webp",
    "optimized image content type",
  );
  assertEqual(webp.headers.get("vary"), "accept", "optimized image vary");

  if (webpBytes >= sourceBytes) {
    throw new Error(
      `optimized image expected fewer than ${sourceBytes} bytes, received ${webpBytes}.`,
    );
  }

  const avif = await fetch(`${origin}/_demiurge/image?src=%2Fhero.png&w=600&q=72`, {
    headers: { accept: "image/avif,image/webp,*/*" },
  });
  await avif.arrayBuffer();
  assertEqual(
    avif.headers.get("content-type"),
    "image/avif",
    "negotiated image content type",
  );

  const etag = webp.headers.get("etag") ?? "";
  const revalidated = await fetch(
    `${origin}/_demiurge/image?src=%2Fhero.png&w=600&q=72`,
    { headers: { accept: "image/webp,*/*", "if-none-match": etag } },
  );
  await revalidated.arrayBuffer();
  assertEqual(revalidated.status, 304, "revalidated image status");

  const disallowed = await fetch(
    `${origin}/_demiurge/image?src=https%3A%2F%2Fevil.test%2Fa.png&w=600`,
  );
  await disallowed.text();
  assertEqual(disallowed.status, 403, "disallowed source status");

  const invalid = await fetch(`${origin}/_demiurge/image?src=%2Fhero.png&w=0`);
  await invalid.text();
  assertEqual(invalid.status, 400, "invalid width status");

  const missing = await fetch(`${origin}/_demiurge/image?src=%2Fmissing.png&w=600`);
  await missing.text();
  assertEqual(missing.status, 404, "missing source status");

  console.log("node image optimizer probe passed");
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
