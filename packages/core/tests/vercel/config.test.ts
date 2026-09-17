import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFunctionConfig,
  createOutputConfig,
  generateVercelNodeOutput,
  vercelNode,
} from "../../src/vercel";

describe("Vercel Node deployment", () => {
  it("creates a Node 22 function configuration with streaming and cancellation", () => {
    expect(createFunctionConfig(vercelNode({
      maxDuration: 60,
      regions: ["iad1"],
    }))).toEqual({
      handler: "index.mjs",
      launcherType: "Nodejs",
      maxDuration: 60,
      regions: ["iad1"],
      runtime: "nodejs22.x",
      shouldAddHelpers: true,
      supportsCancellation: true,
      supportsResponseStreaming: true,
    });
  });

  it("routes static files before the universal request function", () => {
    expect(createOutputConfig()).toEqual({
      routes: [
        { handle: "filesystem" },
        { dest: "/demiurge", src: "^/.*$" },
      ],
      version: 3,
    });
  });

  it("rejects an invalid runtime duration and region list", () => {
    expect(() => vercelNode({ maxDuration: 0 })).toThrow(/maxDuration/);
    expect(() => vercelNode({ regions: [] })).toThrow(/regions/);
  });

  it("writes a function, runtime dependencies, and static assets", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-vercel-node-"));
    const client = join(root, "dist", "client");
    const server = join(root, "dist", "server");
    try {
      await mkdir(join(client, "assets"), { recursive: true });
      await mkdir(join(server), { recursive: true });
      await writeFile(join(client, "index.html"), "dynamic page");
      await writeFile(join(client, "assets", "app.js"), "asset");
      await writeFile(join(client, "demiurge-manifest.json"), "{}");
      await writeFile(join(server, "server-entry.js"), "export {};");
      await writeRuntimePackage(root, "@demiurgejs/core", true);
      await writeRuntimePackage(root, "react");
      await writeRuntimePackage(root, "react-dom");

      const output = await generateVercelNodeOutput({
        clientDir: client,
        deployment: vercelNode({ maxDuration: 30 }),
        projectRoot: root,
        serverDir: server,
      });

      await expect(readFile(join(output, "static", "assets", "app.js"), "utf8"))
        .resolves.toBe("asset");
      await expect(readFile(join(output, "static", "index.html")))
        .rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(output, "functions", "demiurge.func", ".vc-config.json"), "utf8"))
        .resolves.toContain('"maxDuration": 30');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

async function writeRuntimePackage(root: string, name: string, core = false) {
  const directory = join(root, "node_modules", ...name.split("/"));
  await mkdir(core ? join(directory, "dist") : directory, { recursive: true });
  await writeFile(join(directory, "package.json"), "{}");
}
