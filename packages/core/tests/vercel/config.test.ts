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
        {
          dest: "/demiurge",
          methods: ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
          src: "^/.*$",
        },
        {
          dest: "/demiurge",
          has: [{
            key: "x-demiurge-navigation",
            type: "header",
            value: "data",
          }],
          methods: ["GET", "HEAD"],
          src: "^/.*$",
        },
        { handle: "filesystem" },
        { dest: "/demiurge", src: "^/.*$" },
      ],
      version: 3,
    });
  });

  it("routes direct document requests to hybrid static output", () => {
    expect(createOutputConfig({
      adapter: "static",
      entries: [
        {
          file: "index.html",
          headers: {
            "cache-control": "public, max-age=60",
            "content-type": "text/html; charset=utf-8",
          },
          pathname: "/",
          status: 200,
        },
        {
          file: "about/index.html",
          headers: { "content-type": "text/html; charset=utf-8" },
          methods: ["GET"],
          pathname: "/about",
          status: 200,
        },
        {
          file: "404.html",
          headers: { "content-type": "text/html; charset=utf-8" },
          pathname: "*",
          status: 404,
        },
      ],
      fileHeaderRules: [{
        headers: { "cache-control": "public, max-age=31536000, immutable" },
        pattern: "^[^/]*-[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9]+$",
      }, {
        headers: { "cache-control": "public, max-age=0, must-revalidate" },
        pattern: ".*",
      }],
      origin: "https://example.test",
      version: 1,
    }).routes).toEqual([
      expect.objectContaining({ methods: ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"] }),
      expect.objectContaining({
        has: [{ key: "x-demiurge-navigation", type: "header", value: "data" }],
        methods: ["GET", "HEAD"],
      }),
      {
        dest: "/demiurge",
        methods: ["HEAD"],
        src: "^/about/?$",
      },
      {
        dest: "/index.html",
        headers: {
          "access-control-allow-origin": "https://example.test",
          "cache-control": "public, max-age=60",
        },
        methods: ["GET", "HEAD"],
        src: "^/$",
      },
      {
        dest: "/about/index.html",
        headers: { "access-control-allow-origin": "https://example.test" },
        methods: ["GET"],
        src: "^/about/?$",
      },
      { handle: "filesystem" },
      { dest: "/demiurge", src: "^/.*$" },
      { handle: "hit" },
      {
        continue: true,
        headers: { "access-control-allow-origin": "https://example.test" },
        src: "^/.*$",
      },
      {
        continue: true,
        headers: { "cache-control": "public, max-age=0, must-revalidate" },
        src: "^/.*$",
      },
      {
        continue: true,
        headers: { "cache-control": "public, max-age=31536000, immutable" },
        src: "^/(?:.*/)?(?:[^/]*-[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9]+)$",
      },
    ]);
  });

  it("requires an origin for hybrid static responses", () => {
    expect(() => createOutputConfig({
      adapter: "static",
      entries: [{
        file: "about/index.html",
        headers: {},
        pathname: "/about",
        status: 200,
      }],
      fileHeaderRules: [],
      version: 1,
    })).toThrow(/requires a build origin/);
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
      await expect(readFile(join(output, "functions", "demiurge.func", "index.mjs"), "utf8"))
        .resolves.toContain("createHandler: application.createHandler");
      await expect(readFile(join(output, "functions", "demiurge.func", "package.json"), "utf8"))
        .resolves.toBe('{"type":"module"}\n');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("copies hybrid documents without publishing framework manifests", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-vercel-hybrid-"));
    const client = join(root, "dist", "client");
    const server = join(root, "dist", "server");
    const staticOutput = join(root, "dist", "static");
    try {
      await mkdir(client, { recursive: true });
      await mkdir(server, { recursive: true });
      await mkdir(join(staticOutput, "about"), { recursive: true });
      await writeFile(join(client, "demiurge-manifest.json"), "{}");
      await writeFile(join(server, "server-entry.js"), "export {};");
      await writeFile(join(staticOutput, "about", "index.html"), "static about");
      await writeFile(join(staticOutput, "index.html"), "runtime shell");
      await writeFile(join(staticOutput, "demiurge-static-manifest.json"), "private");
      await writeRuntimePackage(root, "@demiurgejs/core", true);
      await writeRuntimePackage(root, "react");
      await writeRuntimePackage(root, "react-dom");

      const manifest = {
        adapter: "static" as const,
        entries: [{
          file: "about/index.html",
          headers: { "content-type": "text/html; charset=utf-8" },
          pathname: "/about",
          status: 200 as const,
        }],
        fileHeaderRules: [],
        origin: "https://example.test",
        version: 1 as const,
      };
      const output = await generateVercelNodeOutput({
        clientDir: client,
        deployment: vercelNode(),
        projectRoot: root,
        serverDir: server,
        staticOutput: { directory: staticOutput, manifest },
      });

      await expect(readFile(join(output, "static", "about", "index.html"), "utf8"))
        .resolves.toBe("static about");
      await expect(readFile(join(output, "static", "demiurge-static-manifest.json")))
        .rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(output, "static", "index.html")))
        .rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(output, "config.json"), "utf8"))
        .resolves.toContain('"dest": "/about/index.html"');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects overlapping client and server output directories", async () => {
    await expect(generateVercelNodeOutput({
      clientDir: "/application/dist",
      deployment: vercelNode(),
      projectRoot: "/application",
      serverDir: "/application/dist/server",
    })).rejects.toThrow(/must not overlap/);
  });

  it.each([
    ["the server directory", "/application/dist/server"],
    ["a server parent", "/application/dist"],
    ["a server child", "/application/dist/server/static"],
    ["a client parent", "/application"],
    ["a client child", "/application/dist/client/static"],
  ])("rejects static output that overlaps %s", async (_case, staticDirectory) => {
    await expect(generateVercelNodeOutput({
      clientDir: "/application/dist/client",
      deployment: vercelNode(),
      projectRoot: "/application",
      serverDir: "/application/dist/server",
      staticOutput: {
        directory: staticDirectory,
        manifest: {
          adapter: "static",
          entries: [],
          fileHeaderRules: [],
          version: 1,
        },
      },
    })).rejects.toThrow(/must not overlap/);
  });
});

async function writeRuntimePackage(root: string, name: string, core = false) {
  const directory = join(root, "node_modules", ...name.split("/"));
  await mkdir(core ? join(directory, "dist") : directory, { recursive: true });
  await writeFile(join(directory, "package.json"), "{}");
}
