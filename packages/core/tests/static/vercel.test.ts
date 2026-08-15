import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { StaticOutputManifest } from "../../src/static";
import {
  createVercelOutputConfig,
  generateVercelStaticOutput,
  vercelStatic,
} from "../../src/static/vercel";

const manifest: StaticOutputManifest = {
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
      file: "about/index.html",
      headers: {
        "content-security-policy": "default-src 'self'",
        "content-type": "text/html; charset=utf-8",
      },
      pathname: "/about",
      status: 200,
    },
    {
      file: "index.html",
      headers: {
        "content-security-policy": "default-src 'none'",
        "content-type": "text/html; charset=utf-8",
      },
      pathname: "/",
      status: 200,
    },
    {
      file: "robots.txt",
      headers: {
        "cache-control": "public, max-age=60",
        "content-type": "text/plain; charset=utf-8",
      },
      pathname: "/robots.txt",
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
};

describe("Vercel static output", () => {
  it("maps route policy, ordered file rules, overrides, and the fallback", () => {
    const config = createVercelOutputConfig(
      manifest,
      vercelStatic({
        cache: [{
          source: "/videos/:path*",
          value: "public, max-age=604800",
        }],
      }),
    );

    expect(config).toMatchObject({
      overrides: {
        "404.html": { contentType: "text/html; charset=utf-8" },
        "about/index.html": {
          contentType: "text/html; charset=utf-8",
          path: "about",
        },
        "index.html": { contentType: "text/html; charset=utf-8" },
        "robots.txt": { contentType: "text/plain; charset=utf-8" },
      },
      version: 3,
    });
    expect(config.routes).toEqual([
      { continue: true, dest: "/about", src: "^/about/index\\.html/?$" },
      { continue: true, dest: "/", src: "^/index\\.html/?$" },
      {
        continue: true,
        headers: { "content-security-policy": "default-src 'none'" },
        src: "^/404\\.html/?$",
      },
      {
        continue: true,
        headers: { "content-security-policy": "default-src 'self'" },
        src: "^/about/?$",
      },
      {
        continue: true,
        headers: { "content-security-policy": "default-src 'none'" },
        src: "^/$",
      },
      {
        continue: true,
        headers: { "cache-control": "public, max-age=60" },
        src: "^/robots\\.txt/?$",
      },
      {
        continue: true,
        headers: { "cache-control": "public, max-age=604800" },
        src: "^/videos(?:/((?:[^/]+?)(?:/(?:[^/]+?))*))?$",
      },
      { dest: "/404.html", src: "^/404\\.html/?$", status: 404 },
      { dest: "/about", src: "^/about/?$" },
      { dest: "/index.html", src: "^/$" },
      { dest: "/robots.txt", src: "^/robots\\.txt/?$" },
      { handle: "hit" },
      {
        continue: true,
        headers: { "cache-control": "public, max-age=0, must-revalidate" },
        src: "^/.*$",
      },
      {
        continue: true,
        headers: { "cache-control": "public, max-age=31536000, immutable" },
        src: "^/(?:.*/)?[^/]*-[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9]+$",
      },
      { handle: "error" },
      {
        continue: true,
        headers: { "content-security-policy": "default-src 'none'" },
        src: "^/.*$",
      },
      {
        continue: true,
        headers: { "cache-control": "public, max-age=604800" },
        src: "^/videos(?:/((?:[^/]+?)(?:/(?:[^/]+?))*))?$",
      },
      { dest: "/404.html", src: "^/.*$", status: 404 },
    ]);
  });

  it("publishes only deployable files and replaces stale Vercel output", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-vercel-"));
    const outDir = join(root, "dist");

    try {
      await mkdir(join(outDir, "assets"), { recursive: true });
      await mkdir(join(root, ".vercel", "output", "static"), { recursive: true });
      await writeFile(join(outDir, "index.html"), "home");
      await writeFile(join(outDir, "demiurge-manifest.json"), "{}");
      await writeFile(join(outDir, "demiurge-static-manifest.json"), "{}");
      await writeFile(join(outDir, "assets", "app-12345678.js"), "app");
      await writeFile(join(root, ".vercel", "output", "static", "stale.txt"), "stale");

      await expect(generateVercelStaticOutput({
        deployment: vercelStatic(),
        manifest,
        outDir,
        projectRoot: root,
      })).resolves.toBe(join(root, ".vercel", "output"));

      await expect(readFile(
        join(root, ".vercel", "output", "static", "index.html"),
        "utf8",
      )).resolves.toBe("home");
      await expect(readFile(
        join(root, ".vercel", "output", "static", "assets", "app-12345678.js"),
        "utf8",
      )).resolves.toBe("app");
      await expect(readFile(
        join(root, ".vercel", "output", "config.json"),
        "utf8",
      )).resolves.toMatch(/"version": 3\n}\n$/);
      await expect(readFile(
        join(root, ".vercel", "output", "static", "demiurge-manifest.json"),
      )).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(
        join(root, ".vercel", "output", "static", "stale.txt"),
      )).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects unsafe output overlap and invalid adapter rules", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-vercel-invalid-"));

    try {
      await expect(generateVercelStaticOutput({
        deployment: vercelStatic(),
        manifest,
        outDir: join(root, ".vercel", "output", "static"),
        projectRoot: root,
      })).rejects.toThrow(/must not overlap/);
      await expect(generateVercelStaticOutput({
        deployment: {
          adapter: "vercel",
          cache: [{ source: "", value: "" }],
        },
        manifest,
        outDir: join(root, "dist"),
        projectRoot: root,
      })).rejects.toThrow(/header rule/);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a missing fallback and untranslatable file patterns", () => {
    expect(() => createVercelOutputConfig(
      { ...manifest, entries: manifest.entries.filter((entry) => entry.pathname !== "*") },
      vercelStatic(),
    )).toThrow(/fallback/);
    expect(() => createVercelOutputConfig(
      {
        ...manifest,
        fileHeaderRules: [{ headers: {}, pattern: "^asset" }],
      },
      vercelStatic(),
    )).toThrow(/cannot translate/);
    expect(() => createVercelOutputConfig(
      manifest,
      vercelStatic({
        cache: [{ source: "/videos/(", value: "public, max-age=60" }],
      }),
    )).toThrow(/header rule is not valid/);
  });
});
