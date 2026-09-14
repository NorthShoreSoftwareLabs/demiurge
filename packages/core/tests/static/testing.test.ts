import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStaticOutputTest, inspectStaticOutput, readStaticOutputManifest, verifyStaticOutput, verifyStaticProvider } from "../../src/static/testing";
import type { StaticOutputManifest } from "../../src/static";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("static output testing utilities", () => {
  it("inspects entries, headers, files, and fallback output", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-static-test-"));
    roots.push(root);
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "index.html"), "home");
    await writeFile(join(root, "404.html"), "missing");
    await writeFile(join(root, "assets", "app.js"), "export {};");
    await symlink(join(root, ".."), join(root, "escape"));
    const manifest: StaticOutputManifest = {
      adapter: "static" as const,
      entries: [
        { file: "404.html", headers: {}, pathname: "*", status: 404 as const },
        { file: "index.html", headers: { "content-type": "text/html" }, pathname: "/", status: 200 as const },
      ],
      fileHeaderRules: [],
      version: 1 as const,
    };
    const output = await inspectStaticOutput(root, manifest);
    expect(output.entry("*")?.status).toBe(404);
    expect(output.headers("/")).toEqual({ "content-type": "text/html" });
    await expect(output.readFile("404.html")).resolves.toSatisfy((value) =>
      new TextDecoder().decode(value) === "missing"
    );
    await expect(output.files()).resolves.toEqual(["404.html", "assets/app.js", "index.html"]);
    await expect(output.readFile("../outside")).rejects.toThrow("outside the output directory");
    await expect(output.readFile("escape")).rejects.toThrow("outside the output directory");
  });

  it("checks manifest files and runs a provider translator", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-static-test-"));
    roots.push(root);
    await writeFile(join(root, "index.html"), "home");
    await mkdir(join(root, "fonts"));
    await mkdir(join(root, "images"));
    await writeFile(join(root, "fonts", "site.woff2"), "font");
    await writeFile(join(root, "images", "hero.webp"), "image");
    const manifest: StaticOutputManifest = {
      adapter: "static" as const,
      entries: [{ file: "index.html", headers: {}, pathname: "/", status: 200 as const }],
      fileHeaderRules: [],
      fontFiles: ["fonts/site.woff2"],
      imageFiles: ["images/hero.webp"],
      version: 1 as const,
    };
    await expect(verifyStaticOutput(root, manifest)).resolves.toBe(manifest);
    await expect(verifyStaticProvider(
      manifest,
      (value) => ({ paths: value.entries.map((entry) => entry.pathname) }),
      (translated) => expect(translated.paths).toEqual(["/"]),
    )).resolves.toEqual({ paths: ["/"] });
  });

  it("loads the manifest from disk and reports missing declared artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-static-test-"));
    roots.push(root);
    const manifest: StaticOutputManifest = {
      adapter: "static",
      entries: [{ file: "index.html", headers: {}, pathname: "/", status: 200 }],
      fileHeaderRules: [],
      fontFiles: ["fonts/site.woff2"],
      version: 1,
    };
    await writeFile(join(root, "demiurge-static-manifest.json"), JSON.stringify(manifest));
    await expect(readStaticOutputManifest(root)).resolves.toEqual(manifest);
    await expect(inspectStaticOutput(root)).resolves.toMatchObject({ manifest });
    await expect(verifyStaticOutput(root, manifest)).rejects.toThrow('missing the declared file "index.html"');
  });

  it("uses the generator boundary and reports static application failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-static-test-"));
    roots.push(root);
    await expect(createStaticOutputTest({ outDir: root, routes: {} })).rejects.toThrow(
      "Static output requires at least one page route",
    );
  });
});
