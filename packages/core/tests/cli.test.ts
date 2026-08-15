import { describe, expect, it, vi } from "vitest";
import type { InlineConfig } from "vite";
import {
  buildStaticSite,
  parseCliArguments,
  parseClientManifest,
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
      parseCliArguments(["build", "--out-dir", "public", "--origin", "https://example.test"]),
      {
        build,
        generate,
        importModule,
        now: () => 42,
        readText: async () => JSON.stringify({
          clientEntry: "/assets/app.js",
          styles: ["/assets/app.css"],
        }),
        root: "/application",
      },
    );

    expect(build).toHaveBeenCalledTimes(2);
    expect(build.mock.calls[0]![0].build?.rollupOptions).toEqual({
      input: "virtual:demiurge/client-entry",
    });
    expect(build.mock.calls[1]![0].build).toMatchObject({
      copyPublicDir: false,
      outDir: "/application/.demiurge/server",
      rollupOptions: {
        input: "virtual:demiurge/server-entry",
        output: { entryFileNames: "server-entry.js" },
      },
      ssr: true,
    });
    expect(importModule).toHaveBeenCalledWith(
      "file:///application/.demiurge/server/server-entry.js?build=42",
    );
    expect(generate).toHaveBeenCalledWith({
      origin: "https://example.test",
      outDir: "/application/public",
      routes: expect.any(Object),
      ssr: {
        clientEntry: "/assets/app.js",
        styles: ["/assets/app.css"],
      },
    });
    expect(result.outDir).toBe("/application/public");
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
      root: "/application",
    })).rejects.toThrow(/does not export routes/);
  });
});
