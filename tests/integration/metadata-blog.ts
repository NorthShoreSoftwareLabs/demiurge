import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve("examples/metadata-blog");
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
  const home = await fetch(`${origin}/`, {
    headers: { accept: "text/html" },
  });
  const homeDocument = await home.text();
  assertEqual(home.status, 200, "home status");
  assertIncludes(homeDocument, "<title>Home | Metadata Blog</title>", "home title");
  assertIncludes(homeDocument, 'rel="canonical" href="/"', "home canonical");
  assertIncludes(homeDocument, 'type="application/ld+json"', "home JSON-LD");
  assertIncludes(homeDocument, '"@type":"Organization"', "organization JSON-LD");

  const post = await fetch(`${origin}/posts/secure-routing`, {
    headers: { accept: "text/html" },
  });
  const postDocument = await post.text();
  assertEqual(post.status, 200, "post status");
  assertIncludes(
    postDocument,
    "<title>Secure routing | Metadata Blog</title>",
    "post title",
  );
  assertIncludes(
    postDocument,
    'rel="canonical" href="/posts/secure-routing"',
    "post canonical",
  );
  assertIncludes(
    postDocument,
    'property="og:image" content="/og/secure-routing/image.svg"',
    "post Open Graph image",
  );
  assertIncludes(
    postDocument,
    'property="og:title" content="Secure routing with typed addresses"',
    "post Open Graph title",
  );
  assertIncludes(postDocument, '"@type":"Article"', "article JSON-LD");

  const sitemap = await fetch(`${origin}/sitemap.xml`);
  assertEqual(sitemap.status, 200, "sitemap status");
  assertIncludes(
    sitemap.headers.get("content-type") ?? "",
    "application/xml",
    "sitemap content type",
  );
  assertIncludes(await sitemap.text(), "/posts/secure-routing", "sitemap");

  const robots = await fetch(`${origin}/robots.txt`);
  assertEqual(robots.status, 200, "robots status");
  assertIncludes(
    robots.headers.get("content-type") ?? "",
    "text/plain",
    "robots content type",
  );
  assertIncludes(await robots.text(), "Sitemap: https://metadata.example.test/sitemap.xml", "robots");

  const image = await fetch(`${origin}/og/secure-routing/image.svg`);
  assertEqual(image.status, 200, "Open Graph image status");
  assertIncludes(
    image.headers.get("content-type") ?? "",
    "image/svg+xml",
    "Open Graph image content type",
  );
  assertEqual(
    image.headers.get("cache-control"),
    "public, max-age=31536000, immutable",
    "Open Graph image cache control",
  );
  assertIncludes(await image.text(), "secure-routing", "Open Graph image");

  console.log("metadata blog probe passed");
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
      rejectOrigin(new Error(`Metadata blog server did not start. ${stderr}`));
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
      rejectOrigin(new Error(`Metadata blog server exited with code ${code}. ${stderr}`));
    });
  });
}
