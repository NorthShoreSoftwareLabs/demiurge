import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { InlineConfig } from "vite";
import {
  buildStaticSite,
  parseCliArguments,
  parseClientManifest,
  resolvePreviewOutputDirectory,
  validateBuildOutputDirectory,
} from "../src/cli";

describe("Demiurge CLI arguments", () => {
  it("uses static build defaults and the configured site origin", () => {
    expect(parseCliArguments(["build"], {
      SITE_ORIGIN: "https://example.test",
    })).toEqual({
      command: "build",
      host: "localhost",
      origin: "https://example.test",
      outDir: "dist",
      port: 4173,
    });
  });

  it("parses preview values in both supported option forms", () => {
    expect(parseCliArguments([
      "preview",
      "--host=127.0.0.1",
      "--out-dir",
      "output",
      "--port=0",
    ])).toEqual({
      command: "preview",
      host: "127.0.0.1",
      origin: undefined,
      outDir: "output",
      port: 0,
    });
  });

  it("rejects unknown commands, unknown options, and invalid ports", () => {
    expect(() => parseCliArguments(["deploy"])).toThrow(/Unknown command/);
    expect(() => parseCliArguments(["build", "--root", "app"]))
      .toThrow(/Unknown option/);
    expect(() => parseCliArguments(["preview", "--port", "70000"]))
      .toThrow(/Preview port/);
    expect(() => parseCliArguments(["preview", "--host"]))
      .toThrow(/requires a value/);
  });

  it("returns help without a command", () => {
    expect(parseCliArguments([]).command).toBe("help");
    expect(parseCliArguments(["--help"]).command).toBe("help");
  });

  it("resolves preview output from the configured Vite root", async () => {
    await expect(resolvePreviewOutputDirectory("dist", async () => ({
      root: "/application/app",
    }))).resolves.toBe("/application/app/dist");
  });

  it("runs the client, server, and static build sequence", async () => {
    const build = vi.fn(async (_config: InlineConfig) => undefined);
    const generate = vi.fn(async () => ({
      adapter: "static" as const,
      entries: [],
      fileHeaderRules: [],
      version: 1 as const,
    }));
    const importModule = vi.fn(async () => ({
      routes: { "./routes/index.tsx": async () => ({}) },
    }));
    const result = await buildStaticSite(
      parseCliArguments([
        "build",
        "--out-dir",
        "output",
        "--origin",
        "https://example.test",
      ]),
      {
        build,
        generate,
        importModule,
        now: () => 42,
        readText: async () => JSON.stringify({
          clientEntry: "/assets/app.js",
          styles: ["/assets/app.css"],
        }),
        resolveConfig: async () => ({
          publicDir: "/application/app/public",
          root: "/application/app",
        }),
      },
    );

    expect(build).toHaveBeenCalledTimes(2);
    expect(build.mock.calls[0]![0]).toMatchObject({
      define: { "process.env.NODE_ENV": '"production"' },
      mode: "production",
    });
    expect(build.mock.calls[0]![0].build?.rollupOptions).toEqual({
      input: "virtual:demiurge/client-entry",
    });
    expect(build.mock.calls[1]![0].build).toMatchObject({
      copyPublicDir: false,
      outDir: "/application/app/.demiurge/server",
      rollupOptions: {
        input: "virtual:demiurge/server-entry",
        output: { entryFileNames: "server-entry.js" },
      },
      ssr: true,
    });
    expect(build.mock.calls[1]![0]).toMatchObject({
      define: { "process.env.NODE_ENV": '"production"' },
      mode: "production",
    });
    expect(build.mock.calls[0]![0].root).toBeUndefined();
    expect(importModule).toHaveBeenCalledWith(
      "file:///application/app/.demiurge/server/server-entry.js?build=42",
    );
    expect(generate).toHaveBeenCalledWith({
      fonts: undefined,
      images: undefined,
      origin: "https://example.test",
      outDir: "/application/app/output",
      root: "/application/app",
      routes: expect.any(Object),
      ssr: {
        clientEntry: "/assets/app.js",
        styles: ["/assets/app.css"],
      },
      staticFileHeaders: [],
    });
    expect(result.outDir).toBe("/application/app/output");
  });

  it("rejects invalid client and server build manifests", async () => {
    expect(() => parseClientManifest("{")).toThrow(/not valid JSON/);
    expect(() => parseClientManifest(JSON.stringify({ styles: [] })))
      .toThrow(/unsupported format/);

    await expect(buildStaticSite(parseCliArguments(["build"]), {
      build: async () => undefined,
      generate: async () => ({
        adapter: "static",
        entries: [],
        fileHeaderRules: [],
        version: 1,
      }),
      importModule: async () => ({ routes: [] }),
      now: () => 0,
      readText: async () => JSON.stringify({ clientEntry: "/app.js", styles: [] }),
      resolveConfig: async () => ({
        publicDir: "/application/public",
        root: "/application",
      }),
    })).rejects.toThrow(/does not export routes/);
  });

  it("rejects output paths that can remove application files", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-cli-output-"));
    const publicDir = join(root, "public");
    const sourceDir = join(root, "source-output");
    const managedDir = join(root, "managed-output");
    const serverDir = join(root, ".demiurge", "server");

    try {
      await mkdir(publicDir);
      await mkdir(sourceDir);
      await mkdir(managedDir);
      await writeFile(join(sourceDir, "application.ts"), "export {};");
      await writeFile(join(managedDir, "demiurge-manifest.json"), "{}");

      await expect(validateBuildOutputDirectory(root, root, publicDir, serverDir))
        .rejects.toThrow(/must be inside/);
      await expect(
        validateBuildOutputDirectory(
          root,
          join(root, ".."),
          publicDir,
          serverDir,
        ),
      ).rejects.toThrow(/must be inside/);
      await expect(
        validateBuildOutputDirectory(root, publicDir, publicDir, serverDir),
      )
        .rejects.toThrow(/must not overlap/);
      await expect(
        validateBuildOutputDirectory(root, join(root, ".demiurge"), publicDir, serverDir),
      ).rejects.toThrow(/framework server/);
      await expect(
        validateBuildOutputDirectory(root, serverDir, publicDir, serverDir),
      ).rejects.toThrow(/framework server/);
      await expect(
        validateBuildOutputDirectory(root, sourceDir, publicDir, serverDir),
      )
        .rejects.toThrow(/did not create/);
      await expect(
        validateBuildOutputDirectory(root, managedDir, publicDir, serverDir),
      )
        .resolves.toBeUndefined();
      await expect(
        validateBuildOutputDirectory(
          root,
          join(root, "new-output"),
          false,
          serverDir,
        ),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
