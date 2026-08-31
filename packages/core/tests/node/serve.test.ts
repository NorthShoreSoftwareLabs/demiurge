import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNodeServer,
  createStaticFileHandler,
  defaultNodeBuildReadyPath,
  serveNodeBuild,
  type NodeServer,
} from "@demiurgejs/core/node";

const started: NodeServer[] = [];
const directories: string[] = [];

afterEach(async () => {
  while (started.length > 0) {
    await started.pop()!.shutdown();
  }

  while (directories.length > 0) {
    await rm(directories.pop()!, { force: true, recursive: true });
  }
});

async function createBuildOutput(
  files: Record<string, string> = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "demiurge-serve-"));
  directories.push(directory);
  const client = join(directory, "dist", "client");
  await mkdir(client, { recursive: true });
  await writeFile(
    join(client, "demiurge-manifest.json"),
    JSON.stringify({ clientEntry: "/assets/entry.js", styles: ["/assets/app.css"] }),
  );

  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(client, name), contents);
  }

  return { base: pathToFileURL(join(directory, "server.js")), client, directory };
}

function track(server: NodeServer) {
  started.push(server);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

describe("serveNodeBuild", () => {
  it("reads the manifest, serves static files, and answers the route handler", async () => {
    const output = await createBuildOutput({ "app.css": "body{}" });
    const page = vi.fn();
    const server = await serveNodeBuild({
      base: output.base,
      createHandler: (context) => {
        page(context.page);
        return async () => new Response("route");
      },
      onListen: () => undefined,
      port: 0,
    });
    const origin = track(server);

    expect(page).toHaveBeenCalledWith({
      clientEntry: "/assets/entry.js",
      renderPage: expect.any(Function),
      styles: ["/assets/app.css"],
    });
    await expect((await fetch(`${origin}/app.css`)).text()).resolves.toBe("body{}");
    await expect((await fetch(`${origin}/`)).text()).resolves.toBe("route");
  });

  it("serves the readiness path and reports draining once readiness is false", async () => {
    const output = await createBuildOutput();
    const server = await serveNodeBuild({
      base: output.base,
      createHandler: () => async () => new Response("route"),
      onListen: () => undefined,
      port: 0,
    });
    const origin = track(server);

    const ready = await fetch(`${origin}${defaultNodeBuildReadyPath}`);
    expect(ready.status).toBe(200);
    expect(ready.headers.get("cache-control")).toBe("no-store");
    await expect(ready.text()).resolves.toBe("ready");

    // A draining server refuses new connections, so the 503 answer reaches
    // only a connection the balancer already holds. Reporting false readiness
    // here proves the same branch over a connection the test can still open.
    const stillReady = server.isReady;
    server.isReady = () => false;
    const draining = await fetch(`${origin}${defaultNodeBuildReadyPath}`);
    expect(draining.status).toBe(503);
    await expect(draining.text()).resolves.toBe("draining");
    server.isReady = stillReady;
  });

  it("leaves the readiness path to the application when it is disabled", async () => {
    const output = await createBuildOutput();
    const server = await serveNodeBuild({
      base: output.base,
      createHandler: () => async () => new Response("application"),
      onListen: () => undefined,
      port: 0,
      readyPath: false,
    });
    const origin = track(server);

    await expect(
      (await fetch(`${origin}${defaultNodeBuildReadyPath}`)).text(),
    ).resolves.toBe("application");
  });

  it("resolves the bind address and the host allowlist from the environment", async () => {
    const output = await createBuildOutput();
    const listen = vi.fn();
    const server = await serveNodeBuild({
      base: output.base,
      createHandler: () => async () => new Response("route"),
      env: { ALLOWED_HOSTS: "app.example.test, localhost", HOST: "127.0.0.1", PORT: "0" },
      onListen: listen,
    });
    const origin = track(server);

    expect(listen).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: expect.any(Number),
      server,
    });
    const rejected = await fetch(`${origin}/`, { headers: { host: "evil.test" } });
    expect(rejected.status).toBe(421);
  });

  it("accepts a static handler factory that composes the client file handler", async () => {
    const output = await createBuildOutput({ "app.css": "body{}" });
    const server = await serveNodeBuild({
      allowedHosts: ["127.0.0.1"],
      base: output.base,
      createHandler: () => async () => new Response("route"),
      onListen: () => undefined,
      port: 0,
      static: (context) => {
        const serveFile = createStaticFileHandler({ root: context.root });
        return async (request) =>
          new URL(request.url).pathname === "/injected"
            ? new Response("injected")
            : serveFile(request);
      },
    });
    const origin = track(server);

    await expect((await fetch(`${origin}/injected`)).text()).resolves.toBe("injected");
    await expect((await fetch(`${origin}/app.css`)).text()).resolves.toBe("body{}");
  });

  it("hands background work to the server the application cannot name yet", async () => {
    const output = await createBuildOutput();
    let settle = () => undefined as void;
    const background = new Promise<void>((resolveBackground) => {
      settle = () => resolveBackground();
    });
    const states: string[] = [];
    const server = await serveNodeBuild({
      base: output.base,
      createHandler: (context) => async () => {
        context.waitUntil(background);
        return new Response("route");
      },
      onListen: () => undefined,
      port: 0,
      shutdown: {
        gracePeriod: 1_000,
        onStateChange: (state) => states.push(state),
      },
    });
    const origin = track(server);

    await (await fetch(`${origin}/`)).text();
    const shutdown = server.shutdown();
    settle();
    await shutdown;
    started.pop();

    expect(states).toEqual(["ready", "draining", "stopped"]);
  });

  it("tracks a waitUntil call made synchronously during createHandler", async () => {
    const output = await createBuildOutput();
    let settle = () => undefined as void;
    const warmup = new Promise<void>((resolveWarmup) => {
      settle = () => resolveWarmup();
    });
    const states: string[] = [];
    const server = await serveNodeBuild({
      base: output.base,
      createHandler: (context) => {
        // Calling waitUntil here, before the server exists, must not throw.
        context.waitUntil(warmup);
        return async () => new Response("route");
      },
      onListen: () => undefined,
      port: 0,
      shutdown: {
        gracePeriod: 1_000,
        onStateChange: (state) => states.push(state),
      },
    });
    started.push(server);

    const shutdown = server.shutdown();
    settle();
    await shutdown;
    started.pop();

    expect(states).toEqual(["ready", "draining", "stopped"]);
  });

  it("logs the bound port with the configured name by default", async () => {
    const output = await createBuildOutput();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const server = await serveNodeBuild({
      base: output.base,
      createHandler: () => async () => new Response("route"),
      name: "Demiurge test server",
      port: 0,
    });
    track(server);

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Demiurge test server listening on http://127.0.0.1:"),
    );
    log.mockRestore();
  });

  it("rejects a port outside the valid range", async () => {
    const output = await createBuildOutput();

    await expect(
      serveNodeBuild({
        base: output.base,
        createHandler: () => async () => new Response("route"),
        env: { PORT: "70000" },
      }),
    ).rejects.toThrow(/PORT must be an integer/);
  });

  it("rejects a manifest the build did not produce", async () => {
    const output = await createBuildOutput();
    await writeFile(join(output.client, "demiurge-manifest.json"), "{}");

    await expect(
      serveNodeBuild({
        base: output.base,
        createHandler: () => async () => new Response("route"),
        port: 0,
      }),
    ).rejects.toThrow(/unsupported format/);
  });
});

describe("createNodeServer readiness path", () => {
  it("rejects a readiness path that is not an absolute path", () => {
    expect(() =>
      createNodeServer({
        allowedHosts: ["127.0.0.1"],
        handler: async () => new Response("route"),
        readyPath: "ready",
      })
    ).toThrow(/absolute path/);
  });

  it("rejects a readiness path that carries a query string", () => {
    expect(() =>
      createNodeServer({
        allowedHosts: ["127.0.0.1"],
        handler: async () => new Response("route"),
        readyPath: "/ready?probe=1",
      })
    ).toThrow(/absolute path/);
  });

  it("answers a custom readiness path before the application handler", async () => {
    const server = createNodeServer({
      allowedHosts: ["127.0.0.1"],
      handler: async () => new Response("route"),
      readyPath: "/healthz",
    });
    started.push(server);
    server.listen(0, "127.0.0.1");
    await new Promise((resolveListen) => server.once("listening", resolveListen));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    await expect(
      (await fetch(`http://127.0.0.1:${port}/healthz`)).text(),
    ).resolves.toBe("ready");
    await expect(
      (await fetch(`http://127.0.0.1:${port}/`)).text(),
    ).resolves.toBe("route");
  });
});
