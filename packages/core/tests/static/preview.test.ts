import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createStaticPreviewServer } from "../../src/static/preview";

const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve) => server.close(() => resolve()))
  ));
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })
  ));
});

async function createOutput() {
  const root = await mkdtemp(join(tmpdir(), "demiurge-preview-"));
  roots.push(root);
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "index.html"), "<h1>Home</h1>");
  await writeFile(join(root, "404.html"), "<h1>Missing</h1>");
  await writeFile(join(root, "feed.json"), '{"ready":true}');
  await writeFile(join(root, "assets", "app-abcdefgh.js"), "export {};");
  await writeFile(join(root, "site.webmanifest"), "{}");
  await writeFile(
    join(root, "demiurge-static-manifest.json"),
    `${JSON.stringify({
      adapter: "static",
      entries: [
        {
          file: "404.html",
          headers: {
            "content-security-policy": "default-src 'none'",
            "content-type": "text/html; charset=utf-8",
          },
          pathname: "*",
          status: 404,
        },
        {
          file: "index.html",
          headers: {
            "content-security-policy": "default-src 'self'",
            "content-type": "text/html; charset=utf-8",
          },
          pathname: "/",
          status: 200,
        },
        {
          file: "feed.json",
          headers: { "content-type": "application/json" },
          pathname: "/feed.json",
          status: 200,
        },
      ],
      fileHeaderRules: [
        {
          headers: { "cache-control": "public, max-age=31536000, immutable" },
          pattern: "-[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9]+$",
        },
        {
          headers: { "cache-control": "public, max-age=0, must-revalidate" },
          pattern: ".*",
        },
      ],
      version: 1,
    }, null, 2)}\n`,
  );
  return root;
}

async function start(root: string) {
  const server = await createStaticPreviewServer({
    host: "127.0.0.1",
    outDir: root,
    port: 0,
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No preview address.");
  return `http://127.0.0.1:${address.port}`;
}

describe("static output preview", () => {
  it("serves route and resource entries with their declared policy", async () => {
    const origin = await start(await createOutput());
    const home = await fetch(`${origin}/?preview=1`);
    const resource = await fetch(`${origin}/feed.json`);
    const missing = await fetch(`${origin}/missing/route`);

    expect(home.status).toBe(200);
    expect(home.headers.get("content-security-policy")).toBe("default-src 'self'");
    await expect(home.text()).resolves.toContain("Home");
    expect(resource.headers.get("content-type")).toBe("application/json");
    await expect(resource.json()).resolves.toEqual({ ready: true });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-security-policy")).toBe("default-src 'none'");
  });

  it("applies the first matching file rule and supports HEAD", async () => {
    const origin = await start(await createOutput());
    const hashed = await fetch(`${origin}/assets/app-abcdefgh.js`);
    const publicFile = await fetch(`${origin}/site.webmanifest`, {
      method: "HEAD",
    });

    expect(hashed.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(publicFile.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(await publicFile.text()).toBe("");
  });

  it("applies route policy to direct generated file URLs", async () => {
    const origin = await start(await createOutput());
    const home = await fetch(`${origin}/index.html`);
    const fallback = await fetch(`${origin}/404.html`);

    expect(home.status).toBe(200);
    expect(home.headers.get("content-security-policy")).toBe("default-src 'self'");
    expect(fallback.status).toBe(404);
    expect(fallback.headers.get("content-security-policy")).toBe(
      "default-src 'none'",
    );
  });

  it("rejects unsupported methods and keeps files inside the output root", async () => {
    const origin = await start(await createOutput());
    const post = await fetch(origin, { method: "POST" });
    const traversal = await fetch(`${origin}/%2e%2e/secret.txt`);

    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
    expect(traversal.status).toBe(404);
  });

  it("rejects malformed request paths and missing declared files", async () => {
    const root = await createOutput();
    const origin = await start(root);
    const malformed = await fetch(`${origin}/%E0%A4%A`);
    await rm(join(root, "index.html"));
    const missing = await fetch(origin);

    expect(malformed.status).toBe(400);
    expect(missing.status).toBe(500);
  });

  it("returns an empty 404 when the manifest has no fallback", async () => {
    const root = await createOutput();
    const file = join(root, "demiurge-static-manifest.json");
    const manifest = JSON.parse(await readFile(file, "utf8"));
    manifest.entries = manifest.entries.filter(
      (entry: { pathname: string }) => entry.pathname !== "*",
    );
    await writeFile(file, JSON.stringify(manifest));
    const origin = await start(root);

    expect((await fetch(`${origin}/missing`)).status).toBe(404);
  });

  it("uses the manifest fallback for directory requests", async () => {
    const origin = await start(await createOutput());

    expect((await fetch(`${origin}/assets`)).status).toBe(404);
    expect((await fetch(`${origin}/assets/`)).status).toBe(404);
  });

  it("fails before listening when the manifest format is invalid", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-preview-invalid-"));
    roots.push(root);
    await writeFile(join(root, "demiurge-static-manifest.json"), "{}");

    await expect(createStaticPreviewServer({ outDir: root, port: 0 }))
      .rejects.toThrow(/unsupported format/);
  });

  it.each([
    ["not JSON", "{", /not valid JSON/],
    [
      "missing arrays",
      JSON.stringify({ adapter: "static", version: 1 }),
      /does not contain header rules/,
    ],
    [
      "invalid entry",
      JSON.stringify({
        adapter: "static",
        entries: [{ file: "index.html" }],
        fileHeaderRules: [],
        version: 1,
      }),
      /invalid entry/,
    ],
    [
      "unsafe entry file",
      JSON.stringify({
        adapter: "static",
        entries: [{ file: "../index.html", headers: {}, pathname: "/", status: 200 }],
        fileHeaderRules: [],
        version: 1,
      }),
      /outside the output directory/,
    ],
    [
      "invalid rule",
      JSON.stringify({
        adapter: "static",
        entries: [],
        fileHeaderRules: [{}],
        version: 1,
      }),
      /invalid file header rule/,
    ],
    [
      "invalid pattern",
      JSON.stringify({
        adapter: "static",
        entries: [],
        fileHeaderRules: [{ headers: {}, pattern: "[" }],
        version: 1,
      }),
      /invalid file header pattern/,
    ],
    [
      "duplicate pathname",
      JSON.stringify({
        adapter: "static",
        entries: [
          { file: "index.html", headers: {}, pathname: "/", status: 200 },
          { file: "index.html", headers: {}, pathname: "/", status: 200 },
        ],
        fileHeaderRules: [],
        version: 1,
      }),
      /repeats pathname/,
    ],
  ])("rejects a manifest with %s", async (_name, source, message) => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-preview-invalid-"));
    roots.push(root);
    await writeFile(join(root, "demiurge-static-manifest.json"), source);

    await expect(createStaticPreviewServer({ outDir: root, port: 0 }))
      .rejects.toThrow(message);
  });
});
