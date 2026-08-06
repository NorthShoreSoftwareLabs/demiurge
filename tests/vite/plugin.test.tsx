import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { json, page, redirect, type RouteModule, type RouteProps } from "demiurge";
import { unstable_createRouteManifest } from "demiurge/internal/testing";
import {
  demiurge,
  unstable_createDevRouteImporters,
  unstable_handleDevRequest,
} from "demiurge/vite";

function View(_props: RouteProps) {
  return null;
}

type PluginHarness = {
  buildStart?: (options: unknown) => void | Promise<void>;
  configResolved?: (config: { root: string }) => void | Promise<void>;
  configureServer?: (server: unknown) => void | Promise<void>;
};

function routeModule(module: RouteModule) {
  return vi.fn(async () => module);
}

describe("Vite plugin dev request handling", () => {
  it("serves HTTP response capabilities", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/api/health.tsx": routeModule({
        GET: json({ ok: true }),
      }),
    });

    const result = await unstable_handleDevRequest(
      manifest,
      new Request("https://example.test/api/health"),
    );

    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) return;

    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual({ ok: true });
  });

  it("serves redirects", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/old-blog.tsx": routeModule({
        GET: redirect("/blog", 301),
      }),
    });

    const result = await unstable_handleDevRequest(
      manifest,
      new Request("https://example.test/old-blog"),
    );

    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) return;

    expect(result.status).toBe(301);
    expect(result.headers.get("location")).toBe("/blog");
  });

  it("falls through page routes to the browser app", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/index.tsx": routeModule({
        GET: page(View),
      }),
    });

    await expect(
      unstable_handleDevRequest(
        manifest,
        new Request("https://example.test/"),
      ),
    ).resolves.toBe("next");
  });

  it("falls through unmatched routes to Vite", async () => {
    const manifest = unstable_createRouteManifest({});

    await expect(
      unstable_handleDevRequest(
        manifest,
        new Request("https://example.test/missing"),
      ),
    ).resolves.toBe("next");
  });

  it("falls back to GET for HEAD requests and strips the body", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/api/health.tsx": routeModule({
        GET: json({ ok: true }),
      }),
    });

    const result = await unstable_handleDevRequest(
      manifest,
      new Request("https://example.test/api/health", { method: "HEAD" }),
    );

    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) return;

    expect(result.status).toBe(200);
    expect(await result.text()).toBe("");
  });

  it("returns method not allowed with supported route methods", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/api/health.tsx": routeModule({
        POST: json({ ok: true }),
      }),
    });

    const result = await unstable_handleDevRequest(
      manifest,
      new Request("https://example.test/api/health", { method: "PUT" }),
    );

    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) return;

    expect(result.status).toBe(405);
    expect(result.headers.get("allow")).toBe("POST");
  });

  it("creates dev route importers from nested route files", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-vite-routes-"));
    const routesDir = join(root, "routes");

    await mkdir(join(routesDir, "api"), { recursive: true });
    await writeFile(join(routesDir, "api", "health.tsx"), "export {}");

    const server = {
      ssrLoadModule: vi.fn(async () => ({ GET: json({ ok: true }) })),
    };

    const routes = await unstable_createDevRouteImporters(
      server as never,
      routesDir,
    );
    const loaded = await routes["./routes/api/health.tsx"]();

    expect(server.ssrLoadModule).toHaveBeenCalledWith(
      join(routesDir, "api", "health.tsx"),
    );
    expect(loaded.GET?.kind).toBe("json");
  });

  it("generates typed routes from buildStart", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-vite-build-"));
    const routesDir = join(root, "routes");
    const outputFile = join(root, "manifest.d.ts");
    const plugin = demiurge({
      routesDir: "routes",
      typedRoutes: { outputFile: "manifest.d.ts" },
    }) as PluginHarness;

    await mkdir(routesDir, { recursive: true });
    await writeFile(join(routesDir, "index.tsx"), "export {}");

    plugin.configResolved?.({ root } as never);
    await plugin.buildStart?.({} as never);

    await expect(readText(outputFile)).resolves.toContain('"/": {};');
  });

  it("wires middleware responses in Vite dev", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-vite-middleware-"));
    const routesDir = join(root, "routes");
    const plugin = demiurge({ routesDir: "routes" }) as PluginHarness;
    const middleware = createMiddlewareHarness();
    const watcher = createWatcherHarness();
    const server = {
      config: { root },
      middlewares: {
        use: middleware.use,
      },
      ssrLoadModule: vi.fn(async () => ({ GET: json({ ok: true }) })),
      watcher,
    };

    await mkdir(join(routesDir, "api"), { recursive: true });
    await writeFile(join(routesDir, "api", "health.tsx"), "export {}");

    plugin.configureServer?.(server as never);

    const request = requestFor("/api/health");
    const response = new CapturingResponse();
    const next = vi.fn();

    await middleware.handler(request as never, response as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.body).toContain('"ok":true');
  });

  it("passes POST request bodies and repeated headers to route handlers", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-vite-post-"));
    const routesDir = join(root, "routes");
    const plugin = demiurge({ routesDir: "routes" }) as PluginHarness;
    const middleware = createMiddlewareHarness();
    const server = {
      config: { root },
      middlewares: {
        use: middleware.use,
      },
      ssrLoadModule: vi.fn(async () => ({
        POST: json(async ({ request }) => ({
          body: await request.text(),
          header: request.headers.get("x-demo"),
        })),
      })),
      watcher: createWatcherHarness(),
    };

    await mkdir(join(routesDir, "api"), { recursive: true });
    await writeFile(join(routesDir, "api", "echo.tsx"), "export {}");

    plugin.configureServer?.(server as never);

    const request = requestFor("/api/echo", {
      body: "hello",
      headers: {
        host: "example.test",
        "x-demo": ["one", "two"],
      },
      method: "POST",
    });
    const response = new CapturingResponse();
    const next = vi.fn();

    await middleware.handler(request as never, response as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(200);
  });

  it("writes empty HEAD middleware responses without a body", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-vite-head-"));
    const routesDir = join(root, "routes");
    const plugin = demiurge({ routesDir: "routes" }) as PluginHarness;
    const middleware = createMiddlewareHarness();
    const server = {
      config: { root },
      middlewares: {
        use: middleware.use,
      },
      ssrLoadModule: vi.fn(async () => ({ GET: json({ ok: true }) })),
      watcher: createWatcherHarness(),
    };

    await mkdir(join(routesDir, "api"), { recursive: true });
    await writeFile(join(routesDir, "api", "health.tsx"), "export {}");

    plugin.configureServer?.(server as never);

    const response = new CapturingResponse();
    await middleware.handler(
      requestFor("/api/health", { method: "HEAD" }) as never,
      response as never,
      vi.fn(),
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("");
  });

  it("watches route files when typed routes are enabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-vite-watch-"));
    const routesDir = join(root, "routes");
    const outputFile = join(root, "routes.d.ts");
    const plugin = demiurge({
      routesDir: "routes",
      typedRoutes: { outputFile: "routes.d.ts" },
    }) as PluginHarness;
    const watcher = createWatcherHarness();
    const middleware = createMiddlewareHarness();

    await mkdir(routesDir, { recursive: true });
    await writeFile(join(routesDir, "index.tsx"), "export {}");

    plugin.configureServer?.({
      config: { root },
      middlewares: { use: middleware.use },
      ssrLoadModule: vi.fn(),
      watcher,
    } as never);

    expect(watcher.add).toHaveBeenCalledWith(routesDir);

    watcher.emit("add", join(routesDir, "blog.tsx"));
    watcher.emit("change", join(routesDir, "blog.txt"));
    watcher.emit("unlink", join(root, "outside.tsx"));

    await expect(readTextEventually(outputFile)).resolves.toContain('"/": {};');
  });

  it("passes middleware errors to Vite next", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-vite-error-"));
    const routesDir = join(root, "routes");
    const plugin = demiurge({ routesDir: "routes" }) as PluginHarness;
    const middleware = createMiddlewareHarness();
    const error = new Error("load failed");
    const server = {
      config: { root },
      middlewares: {
        use: middleware.use,
      },
      ssrLoadModule: vi.fn(async () => {
        throw error;
      }),
      watcher: createWatcherHarness(),
    };

    await mkdir(routesDir, { recursive: true });
    await writeFile(join(routesDir, "api.tsx"), "export {}");

    plugin.configureServer?.(server as never);

    const next = vi.fn();
    await middleware.handler(requestFor("/api") as never, new CapturingResponse() as never, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

async function readText(file: string) {
  return await import("node:fs/promises").then((fs) => fs.readFile(file, "utf8"));
}

async function readTextEventually(file: string) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await readText(file);
    } catch (error) {
      lastError = error;
      await new Promise((resolveAttempt) => setTimeout(resolveAttempt, 5));
    }
  }

  throw lastError;
}

function createMiddlewareHarness() {
  let handler:
    | ((request: unknown, response: unknown, next: (error?: unknown) => void) => Promise<void>)
    | undefined;

  return {
    get handler() {
      if (!handler) {
        throw new Error("Middleware was not registered.");
      }
      return handler;
    },
    use(
      nextHandler: (
        request: unknown,
        response: unknown,
        next: (error?: unknown) => void,
      ) => Promise<void>,
    ) {
      handler = nextHandler;
    },
  };
}

function createWatcherHarness() {
  const handlers = new Map<string, (file: string) => void>();

  return {
    add: vi.fn(),
    emit(event: string, file: string) {
      handlers.get(event)?.(file);
    },
    on: vi.fn((event: string, handler: (file: string) => void) => {
      handlers.set(event, handler);
    }),
  };
}

function requestFor(
  url: string,
  options: {
    body?: string;
    headers?: Record<string, string | string[]>;
    method?: string;
  } = {},
) {
  return Object.assign(
    Readable.from(options.body ? [Buffer.from(options.body)] : []),
    {
    headers: options.headers ?? {
      host: "example.test",
    },
    method: options.method ?? "GET",
    url,
    },
  );
}

class CapturingResponse extends Writable {
  statusCode = 0;
  statusMessage = "";
  headers = new Map<string, string | number | readonly string[]>();
  body = "";

  setHeader(name: string, value: string | number | readonly string[]) {
    this.headers.set(name.toLowerCase(), value);
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    this.body += chunk.toString();
    callback();
  }
}
