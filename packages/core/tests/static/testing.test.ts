import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectStaticOutput, verifyStaticOutput, verifyStaticProvider } from "../../src/static/testing";
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
  });

  it("checks manifest files and runs a provider translator", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-static-test-"));
    roots.push(root);
    await writeFile(join(root, "index.html"), "home");
    const manifest: StaticOutputManifest = {
      adapter: "static" as const,
      entries: [{ file: "index.html", headers: {}, pathname: "/", status: 200 as const }],
      fileHeaderRules: [],
      version: 1 as const,
    };
    await expect(verifyStaticOutput(root, manifest)).resolves.toBe(manifest);
    await expect(verifyStaticProvider(
      manifest,
      (value) => ({ paths: value.entries.map((entry) => entry.pathname) }),
      (translated) => expect(translated.paths).toEqual(["/"]),
    )).resolves.toEqual({ paths: ["/"] });
  });
});
