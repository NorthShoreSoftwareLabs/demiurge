import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, resolveConfig } from "vite";
import {
  defineEnvSchema,
  env,
  EnvValidationError,
  json,
  readEnv,
  unstable_resetEnvironment as resetEnvironment,
} from "@demiurgejs/core";
import { unstable_demiurge as demiurge } from "@demiurgejs/core/vite";

type DevMiddleware = (
  request: unknown,
  response: unknown,
  next: (error?: unknown) => void,
) => void | Promise<void>;

type PluginHarness = {
  configResolved?: (config: unknown) => void;
  configureServer?: (server: unknown) => (() => void) | void;
};

const roots: string[] = [];
const schema = defineEnvSchema({
  SITE_PASSWORD: env.secret({ critical: true, minLength: 1 }),
});

afterEach(async () => {
  resetEnvironment();
  delete process.env.SITE_PASSWORD;
  for (const root of roots.splice(0)) {
    await rm(root, { force: true, recursive: true });
  }
});

async function createRoot() {
  const root = await mkdtemp(join(tmpdir(), "demiurge-env-dev-"));
  roots.push(root);
  const routesDir = join(root, "routes");
  await mkdir(routesDir, { recursive: true });
  await writeFile(join(routesDir, "index.tsx"), "export {}");

  return root;
}

function createMiddlewareHarness() {
  const handlers: DevMiddleware[] = [];

  return {
    get handler() {
      const [first] = handlers;

      if (!first) {
        throw new Error("Middleware was not registered.");
      }

      return first;
    },
    use(handler: DevMiddleware) {
      handlers.push(handler);
    },
  };
}

function createWatcherHarness() {
  return { add: vi.fn(), on: vi.fn() };
}

function createLogger() {
  return { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

function startPlugin(
  plugin: PluginHarness,
  root: string,
  logger: ReturnType<typeof createLogger>,
) {
  plugin.configResolved?.({ command: "serve", logger, root });
}

function requestFor(url: string) {
  return Object.assign(Readable.from([]), {
    headers: { host: "example.test" },
    method: "GET",
    url,
  });
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

function createServerHarness(
  root: string,
  logger: ReturnType<typeof createLogger>,
  middleware: ReturnType<typeof createMiddlewareHarness>,
) {
  return {
    config: { logger, root },
    middlewares: { use: middleware.use },
    ssrLoadModule: vi.fn(async () => ({
      GET: json({ password: readEnv(schema).SITE_PASSWORD }),
    })),
    transformIndexHtml: vi.fn(async (_url: string, html: string) => html),
    watcher: createWatcherHarness(),
  };
}

describe("development environment startup", () => {
  it("gives a request the variables that the configuration declares", async () => {
    process.env.SITE_PASSWORD = "a-development-password";
    const root = await createRoot();
    const plugin = demiurge({ env: schema, routesDir: "routes" }) as PluginHarness;
    const middleware = createMiddlewareHarness();
    const logger = createLogger();

    startPlugin(plugin, root, logger);
    plugin.configureServer?.(createServerHarness(root, logger, middleware) as never);

    const response = new CapturingResponse();
    await middleware.handler(requestFor("/") as never, response as never, vi.fn());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      password: "a-development-password",
    });
  });

  it("stops the start when a critical variable is absent", async () => {
    const root = await createRoot();
    const plugin = demiurge({ env: schema, routesDir: "routes" }) as PluginHarness;

    expect(() => startPlugin(plugin, root, createLogger())).toThrow(
      EnvValidationError,
    );
  });

  // Vite creates the file watcher after it resolves the configuration and
  // before it calls `configureServer`. The environment therefore starts while
  // the configuration resolves, because a failure there leaves no open handle
  // and `demiurge dev` can exit.
  it("fails while Vite resolves the configuration", async () => {
    const root = await createRoot();

    await expect(
      resolveConfig(
        {
          configFile: false,
          logLevel: "silent",
          plugins: [demiurge({ env: schema, routesDir: "routes", styles: false })],
          root,
        },
        "serve",
      ),
    ).rejects.toThrow(EnvValidationError);
  });

  it("rejects the development server start and leaves no watcher", async () => {
    const root = await createRoot();
    const start = createServer({
      configFile: false,
      logLevel: "silent",
      plugins: [demiurge({ env: schema, routesDir: "routes", styles: false })],
      root,
      server: { middlewareMode: true },
    });

    await expect(start).rejects.toThrow(EnvValidationError);
  });

  it("warns and starts when a required variable is not critical", async () => {
    const root = await createRoot();
    const logger = createLogger();
    const plugin = demiurge({
      env: defineEnvSchema({ ANALYTICS_TOKEN: env.string() }),
      routesDir: "routes",
    }) as PluginHarness;
    startPlugin(plugin, root, logger);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("ANALYTICS_TOKEN"),
    );
  });
});
