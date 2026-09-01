import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { InlineConfig } from "vite";
import {
  parseCliArguments,
  parseClientManifest,
  resolvePreviewOutputDirectory,
  runBuild,
  validateBuildOutputDirectory,
} from "../src/cli";
import type { ResolvedDemiurgeConfig } from "../src/config/types";

function resolvedConfig(
  config: Partial<ResolvedDemiurgeConfig> = {},
): ResolvedDemiurgeConfig {
  return {
    configFile: "/application/app/demiurge.config.ts",
    root: "/application/app",
    ...config,
  };
}

function buildRuntime() {
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
  return {
    build,
    createViteConfig: vi.fn(async (overrides: InlineConfig) => overrides),
    generate,
    importModule,
    now: () => 42,
    readText: async () =>
      JSON.stringify({
        clientEntry: "/assets/app.js",
        styles: ["/assets/app.css"],
      }),
  };
}

describe("Demiurge CLI arguments", () => {
  it("uses build defaults and the configured site origin", () => {
    expect(parseCliArguments(["build"], {
      SITE_ORIGIN: "https://example.test",
    })).toEqual({
      command: "build",
      host: "localhost",
      origin: "https://example.test",
      outDir: undefined,
      port: 4173,
    });
  });

  it("gives the development server its own default port", () => {
    expect(parseCliArguments(["dev"]).port).toBe(5173);
    expect(parseCliArguments(["dev", "--port=3000"]).port).toBe(3000);
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
      .toThrow(/server port/);
    expect(() => parseCliArguments(["preview", "--host"]))
      .toThrow(/requires a value/);
  });

  it("returns help without a command and after a command", () => {
    expect(parseCliArguments([]).command).toBe("help");
    expect(parseCliArguments(["--help"]).command).toBe("help");
    expect(parseCliArguments(["dev", "--help"]).command).toBe("help");
    expect(parseCliArguments(["build", "-h"]).command).toBe("help");
  });

  it("resolves preview output from the project root", () => {
    expect(resolvePreviewOutputDirectory("/application/app", "output"))
      .toBe("/application/app/output");
    expect(
      resolvePreviewOutputDirectory("/application/app", undefined, "public-site"),
    ).toBe("/application/app/public-site");
    expect(resolvePreviewOutputDirectory("/application/app", undefined))
      .toBe("/application/app/dist");
  });
});

describe("Demiurge build", () => {
  it("builds only the client bundle without a deployment target", async () => {
    const runtime = buildRuntime();
    const result = await runBuild(
      parseCliArguments(["build"]),
      resolvedConfig(),
      runtime,
    );

    expect(runtime.build).toHaveBeenCalledTimes(1);
    expect(runtime.build.mock.calls[0]![0]).toMatchObject({
      define: { "process.env.NODE_ENV": '"production"' },
      mode: "production",
    });
    expect(runtime.build.mock.calls[0]![0].build?.rollupOptions).toEqual({
      input: "virtual:demiurge/client-entry",
    });
    expect(result).toEqual({
      outDir: "/application/app/dist",
      serverOutDir: undefined,
    });
  });

  it("builds the application server entry that the configuration declares", async () => {
    const runtime = buildRuntime();
    const result = await runBuild(
      parseCliArguments(["build"]),
      resolvedConfig({
        deployment: {
          outDir: "dist/client",
          server: { entry: "src/server-entry.ts" },
        },
      }),
      runtime,
    );

    expect(runtime.build).toHaveBeenCalledTimes(2);
    expect(runtime.build.mock.calls[1]![0].build).toMatchObject({
      copyPublicDir: false,
      outDir: "/application/app/dist/server",
      rollupOptions: { input: "/application/app/src/server-entry.ts" },
      ssr: true,
    });
    expect(result.outDir).toBe("/application/app/dist/client");
    expect(result.serverOutDir).toBe("/application/app/dist/server");
  });

  it("runs the framework server build and the static generation", async () => {
    const runtime = buildRuntime();
    const result = await runBuild(
      parseCliArguments([
        "build",
        "--out-dir",
        "output",
        "--origin",
        "https://example.test",
      ]),
      resolvedConfig({ deployment: { static: { origin: "https://config.test" } } }),
      runtime,
    );

    expect(runtime.build).toHaveBeenCalledTimes(2);
    expect(runtime.build.mock.calls[1]![0].build).toMatchObject({
      copyPublicDir: false,
      outDir: "/application/app/.demiurge/server",
      rollupOptions: {
        input: "virtual:demiurge/server-entry",
        output: { entryFileNames: "server-entry.js" },
      },
      ssr: true,
    });
    expect(runtime.importModule).toHaveBeenCalledWith(
      "file:///application/app/.demiurge/server/server-entry.js?build=42",
    );
    expect(runtime.generate).toHaveBeenCalledWith({
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
    expect(result.manifest).toBeDefined();
  });

  it("uses the configured origin when the command does not give one", async () => {
    const runtime = buildRuntime();
    await runBuild(
      parseCliArguments(["build"]),
      resolvedConfig({ deployment: { static: { origin: "https://config.test" } } }),
      runtime,
    );

    expect(runtime.generate).toHaveBeenCalledWith(
      expect.objectContaining({ origin: "https://config.test" }),
    );
  });

  it("rejects invalid client and server build manifests", async () => {
    expect(() => parseClientManifest("{")).toThrow(/not valid JSON/);
    expect(() => parseClientManifest(JSON.stringify({ styles: [] })))
      .toThrow(/unsupported format/);

    const runtime = buildRuntime();
    await expect(runBuild(
      parseCliArguments(["build"]),
      resolvedConfig({ deployment: { static: {} } }),
      { ...runtime, importModule: async () => ({ routes: [] }) },
    )).rejects.toThrow(/does not export routes/);
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
