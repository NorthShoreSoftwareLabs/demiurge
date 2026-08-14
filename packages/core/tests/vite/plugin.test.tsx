import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  defineLinks,
  defineMetadata,
  defineRoutePolicy,
  defineScripts,
  json,
  jsonl,
  link,
  meta,
  modulePreload,
  page,
  preconnect,
  preload,
  redirect,
  resolveMetadata,
  security,
  script,
  serverTiming,
  sse,
  stream,
  structuredData,
  text,
  webhook,
  type RouteModule,
  type RouteProps,
} from "@demiurgejs/core";
import { unstable_createRouteManifest } from "@demiurgejs/core/internal/testing";
import {
  demiurge,
  unstable_assertRootNotFoundRoute,
  unstable_declaresPageRoute,
  unstable_createClientEntrySource,
  unstable_createServerEntrySource,
  unstable_createDevRouteImporters,
  unstable_createDocumentHtml,
  unstable_handleDevRequest,
  unstable_stripClientPageData,
} from "@demiurgejs/core/vite";

function View(_props: RouteProps) {
  return null;
}

function DevPage({ data }: RouteProps<string, { message: string }>) {
  return <main>{data.message}</main>;
}

type PluginHarness = {
  buildStart?: (options?: unknown) => void | Promise<void>;
  config?: (config: Record<string, unknown>) => Record<string, unknown>;
  configResolved?: (config: {
    command?: string;
    root: string;
  }) => void | Promise<void>;
  configureServer?: (server: unknown) => (() => void) | void;
  generateBundle?: (
    this: { emitFile: (asset: { fileName: string; source: string; type: string }) => void },
    outputOptions: unknown,
    bundle: unknown,
  ) => void;
  load?: (id: string) => string | null;
  resolveId?: (id: string) => string | null;
};

function routeModule(module: RouteModule) {
  return vi.fn(async () => module);
}

describe("Vite plugin dev request handling", () => {
  it("strips page data and data-only server imports from client route modules", () => {
    const source = `
import { readSecret } from "./secrets.server.js";
import { page } from "@demiurgejs/core";
const View = () => null;
export const GET = page({
  data: async () => ({ secret: await readSecret() }),
  view: View,
});`;
    const transformed = unstable_stripClientPageData(source);

    expect(transformed).toContain("data: undefined");
    expect(transformed).not.toContain("readSecret");
    expect(transformed).not.toContain("secrets.server");
    expect(transformed).toContain("view: View");
  });

  it("strips document contributions and their server-only imports from client routes", () => {
    const source = `
import { privateCdn } from "./document.server.js";
import { defineLinks, defineMetadata, defineScripts, page } from "@demiurgejs/core";
export const links = defineLinks(() => [privateCdn.link()]);
export const metadata = defineMetadata({ title: privateCdn.title });
const routeScripts = defineScripts(() => [privateCdn.script()]);
export { routeScripts as scripts };
export const GET = page({ view: () => null });`;
    const transformed = unstable_stripClientPageData(source);

    expect(transformed).not.toContain("privateCdn");
    expect(transformed).not.toContain("document.server");
    expect(transformed).toContain("export const links = undefined");
    expect(transformed).toContain("export const metadata = undefined");
    expect(transformed).toContain("const routeScripts = undefined");
    expect(transformed).toContain("view: () => null");
  });

  it("rejects server-only imports used by client route code", () => {
    const source = `
import { secret } from "./secrets.server.js";
import { page } from "@demiurgejs/core";
export const GET = page({ data: () => secret, view: () => secret });`;

    expect(() => unstable_stripClientPageData(source)).toThrow(
      /Server-only import "secret" is used by client route code/,
    );
  });

  it("configures and loads both framework virtual entries", () => {
    const plugin = demiurge({ styles: false }) as PluginHarness;

    expect(plugin.config?.({})).toMatchObject({
      appType: "custom",
      build: { rollupOptions: { input: "virtual:demiurge/client-entry" } },
    });
    expect(
      plugin.config?.({
        build: { rollupOptions: { input: "src/custom-entry.ts" } },
      }),
    ).toMatchObject({
      build: { rollupOptions: { input: "src/custom-entry.ts" } },
    });

    expect(plugin.resolveId?.("virtual:demiurge/client-entry")).toBe(
      "\0virtual:demiurge/client-entry",
    );
    expect(plugin.resolveId?.("virtual:demiurge/server-entry")).toBe(
      "\0virtual:demiurge/server-entry",
    );
    expect(plugin.resolveId?.("unrelated")).toBeNull();
    expect(plugin.load?.("\0virtual:demiurge/client-entry")).toContain(
      "hydrateFileRouter",
    );
    expect(plugin.load?.("\0virtual:demiurge/server-entry")).toContain(
      "createRequestHandler",
    );
    expect(plugin.load?.("unrelated")).toBeNull();
  });

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

  it("adds Server-Timing headers in Vite dev", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/api/health.tsx": routeModule({
        GET: json(
          { ok: true },
          {
            timing: serverTiming({ duration: 4, name: "route" }),
          },
        ),
      }),
    });

    const result = await unstable_handleDevRequest(
      manifest,
      new Request("https://example.test/api/health"),
    );

    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) return;

    expect(result.headers.get("server-timing")).toBe("route;dur=4");
  });

  it("serves server-sent event responses in Vite dev", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/api/events.tsx": routeModule({
        GET: sse([{ data: "ready", event: "status" }]),
      }),
    });

    const result = await unstable_handleDevRequest(
      manifest,
      new Request("https://example.test/api/events"),
    );

    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) return;

    expect(result.headers.get("content-type")).toBe(
      "text/event-stream; charset=utf-8",
    );
    await expect(result.text()).resolves.toBe(
      "event: status\ndata: ready\n\n",
    );
  });

  it("serves JSON Lines responses in Vite dev", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/api/feed.tsx": routeModule({
        GET: jsonl([{ id: 1 }, { id: 2 }]),
      }),
    });

    const result = await unstable_handleDevRequest(
      manifest,
      new Request("https://example.test/api/feed"),
    );

    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) return;

    expect(result.headers.get("content-type")).toBe(
      "application/x-ndjson; charset=utf-8",
    );
    await expect(result.text()).resolves.toBe('{"id":1}\n{"id":2}\n');
  });

  it("serves generic stream responses in Vite dev", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/api/download.tsx": routeModule({
        GET: stream(["hello ", "world"], {
          headers: {
            "content-type": "text/plain; charset=utf-8",
          },
        }),
      }),
    });

    const result = await unstable_handleDevRequest(
      manifest,
      new Request("https://example.test/api/download"),
    );

    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) return;

    expect(result.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    await expect(result.text()).resolves.toBe("hello world");
  });

  it("serves CORS preflight responses in Vite dev", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/api/posts.tsx": routeModule({
        POST: json(
          { ok: true },
          {
            cors: {
              headers: ["content-type"],
              methods: ["POST"],
              origins: ["https://app.example.com"],
            },
          },
        ),
      }),
    });

    const result = await unstable_handleDevRequest(
      manifest,
      new Request("https://example.test/api/posts", {
        headers: {
          "access-control-request-method": "POST",
          origin: "https://app.example.com",
        },
        method: "OPTIONS",
      }),
    );

    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) return;

    expect(result.status).toBe(204);
    expect(result.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.com",
    );
    expect(result.headers.get("access-control-allow-methods")).toBe("POST");
  });

  it("enforces request body limits in Vite dev", async () => {
    const handlerSpy = vi.fn(({ request }: { request: Request }) => request.text());
    const manifest = unstable_createRouteManifest({
      "./routes/api/echo.tsx": routeModule({
        POST: text(handlerSpy, {
          security: {
            request: {
              maxBodySize: "4b",
            },
          },
        }),
      }),
    });

    const result = await unstable_handleDevRequest(
      manifest,
      new Request("https://example.test/api/echo", {
        body: "hello",
        headers: {
          "content-length": "5",
        },
        method: "POST",
      }),
    );

    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) return;

    expect(result.status).toBe(413);
    await expect(result.text()).resolves.toBe("Request body too large.");
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("enforces request allowed methods in Vite dev", async () => {
    const handlerSpy = vi.fn(() => "deleted");
    const manifest = unstable_createRouteManifest({
      "./routes/api/profile.tsx": routeModule({
        DELETE: text(handlerSpy, {
          security: {
            request: {
              allowedMethods: ["POST"],
            },
          },
        }),
      }),
    });

    const result = await unstable_handleDevRequest(
      manifest,
      new Request("https://example.test/api/profile", {
        method: "DELETE",
      }),
    );

    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) return;

    expect(result.status).toBe(405);
    expect(result.headers.get("allow")).toBe("POST");
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("enforces rate limits in Vite dev", async () => {
    const handlerSpy = vi.fn(() => "ok");
    const manifest = unstable_createRouteManifest({
      "./routes/api/rate-limited.tsx": routeModule({
        POST: text(handlerSpy, {
          security: {
            rateLimit: {
              key: {
                header: "x-vite-rate-limit-user",
              },
              limit: 1,
              window: "1m",
            },
          },
        }),
      }),
    });
    const request = () =>
      new Request("https://example.test/api/rate-limited", {
        headers: {
          "x-vite-rate-limit-user": "demo",
        },
        method: "POST",
      });

    const first = await unstable_handleDevRequest(manifest, request());
    const second = await unstable_handleDevRequest(manifest, request());

    expect(first).toBeInstanceOf(Response);
    expect(second).toBeInstanceOf(Response);
    if (!(first instanceof Response) || !(second instanceof Response)) return;

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.headers.get("x-ratelimit-limit")).toBe("1");
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it("enforces CSRF protection in Vite dev", async () => {
    const handlerSpy = vi.fn(({ request }: { request: Request }) => request.text());
    const manifest = unstable_createRouteManifest({
      "./routes/api/profile.tsx": routeModule({
        POST: text(handlerSpy, {
          security: {
            csrf: true,
          },
        }),
      }),
    });

    const result = await unstable_handleDevRequest(
      manifest,
      new Request("https://example.test/api/profile", {
        body: "name=demo",
        headers: {
          cookie: "csrf-token=abc",
          "x-csrf-token": "wrong",
        },
        method: "POST",
      }),
    );

    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) return;

    expect(result.status).toBe(403);
    await expect(result.text()).resolves.toBe("Invalid CSRF token.");
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("verifies HMAC webhooks in Vite dev", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/api/webhook.tsx": routeModule({
        POST: webhook.hmac({
          handler: ({ text }) => Response.json({ rawBody: text() }),
          secret: "top-secret",
        }),
      }),
    });
    const body = "{\"vite\":true}";
    const signature = await hmacSignature(body, "top-secret");

    const result = await unstable_handleDevRequest(
      manifest,
      new Request("https://example.test/api/webhook", {
        body,
        headers: {
          "x-webhook-signature": signature,
        },
        method: "POST",
      }),
    );

    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) return;

    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual({ rawBody: body });
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

  it("renders page routes through the shared request pipeline", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/index.tsx": routeModule({
        GET: page(View),
      }),
    });

    const result = await unstable_handleDevRequest(
      manifest,
      new Request("https://example.test/"),
    );

    expect(result).toBeInstanceOf(Response);
    if (result instanceof Response) {
      expect(result.headers.get("content-type")).toBe(
        "text/html; charset=utf-8",
      );
    }
  });

  it("applies inherited document policies to Vite page responses", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/@policy.ts": routeModule({
        policy: defineRoutePolicy({ document: security.strict() }),
      }),
      "./routes/index.tsx": routeModule({ GET: page(View) }),
    });

    const result = await unstable_handleDevRequest(
      manifest,
      new Request("https://example.test/"),
    );

    expect(result).toBeInstanceOf(Response);
    if (result instanceof Response) {
      expect(result.headers.get("content-security-policy")).toContain(
        "script-src 'nonce-",
      );
    }
  });

  it("applies inherited middleware before Vite page rendering", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/@middleware.ts": routeModule({
        middleware: async (_context, _next) =>
          new Response("blocked by middleware", { status: 451 }),
      }),
      "./routes/index.tsx": routeModule({ GET: page(View) }),
    });

    const result = await unstable_handleDevRequest(
      manifest,
      new Request("https://example.test/"),
    );

    expect(result).toBeInstanceOf(Response);
    if (result instanceof Response) {
      expect(result.status).toBe(451);
      await expect(result.text()).resolves.toBe("blocked by middleware");
    }
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

  it("writes typed routes to a hidden framework directory by default", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-vite-build-default-"));
    const routesDir = join(root, "src", "routes");
    const outputFile = join(root, ".demiurge", "route-manifest.d.ts");
    const plugin = demiurge({ typedRoutes: true }) as PluginHarness;

    await mkdir(routesDir, { recursive: true });
    await writeFile(join(routesDir, "blog.tsx"), "export {}");

    plugin.configResolved?.({ root } as never);
    await plugin.buildStart?.({} as never);

    await expect(readText(outputFile)).resolves.toContain('"/blog": {};');
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

  it("serves the framework document for page routes in Vite dev", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-vite-document-"));
    const routesDir = join(root, "routes");
    const plugin = demiurge({
      document: { title: "Docs & Routes" },
      routesDir: "routes",
    }) as PluginHarness;
    const middleware = createMiddlewareHarness();
    const server = {
      config: { root },
      middlewares: {
        use: middleware.use,
      },
      ssrLoadModule: vi.fn(async (file: string) => {
        if (file.endsWith("@layout.tsx")) {
          return {
            default: View,
            links: defineLinks([
              preconnect("https://api.example.com"),
            ]),
            metadata: defineMetadata({
              description: "Root document description",
              title: {
                default: "Docs & Routes",
                format: (title) => `${title} | Demo`,
              },
            }),
            scripts: defineScripts([
              script({
                src: "https://cdn.example.com/root.js",
                strategy: "beforeInteractive",
              }),
            ]),
          };
        }

        return {
          GET: page(View),
          links: defineLinks(({ search }) =>
            search.get("hero") === "true"
              ? [preload("/hero.avif", { as: "image" })]
              : [],
          ),
          metadata: defineMetadata({
            title: "Route document",
          }),
          scripts: defineScripts(({ search }) =>
            search.get("checkout") === "true"
              ? [script({ src: "https://js.stripe.com/v3/" })]
              : [],
          ),
        };
      }),
      transformIndexHtml: vi.fn(async (_url: string, html: string) =>
        html.replace("</head>", '<script type="module" src="/@vite/client"></script></head>'),
      ),
      watcher: createWatcherHarness(),
    };

    await mkdir(routesDir, { recursive: true });
    await writeFile(join(routesDir, "@layout.tsx"), "export {}");
    await writeFile(join(routesDir, "index.tsx"), "export {}");

    plugin.configureServer?.(server as never);

    const response = new CapturingResponse();
    await middleware.handler(
      requestFor("/?hero=true&checkout=true", {
        headers: {
          accept: "text/html",
          host: "example.test",
        },
      }) as never,
      response as never,
      vi.fn(),
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.body).toContain("<title>Route document | Demo</title>");
    expect(response.body).toContain(
      '<meta name="description" content="Root document description" />',
    );
    expect(response.body).toContain(
      '<link rel="preconnect" href="https://api.example.com" />',
    );
    expect(response.body).toContain(
      '<link rel="preload" href="/hero.avif" as="image" />',
    );
    expect(response.body).toContain(
      '<script src="https://cdn.example.com/root.js"></script>',
    );
    expect(response.body).toContain(
      '<script src="https://js.stripe.com/v3/"></script>',
    );
    expect(response.body).toContain(
      'src="/@id/virtual:demiurge/client-entry"',
    );
    expect(response.body).toContain("/@vite/client");
  });

  it("streams page routes through Vite's transformed dev shell", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-vite-streaming-"));
    const routesDir = join(root, "routes");
    const plugin = demiurge({ routesDir: "routes" }) as PluginHarness;
    const middleware = createMiddlewareHarness();
    const transformIndexHtml = vi.fn(async (_url: string, html: string) =>
      html.replace(
        "</head>",
        '<script type="module" src="/@vite/client"></script></head>',
      )
    );
    const server = {
      config: { root },
      middlewares: { use: middleware.use },
      ssrLoadModule: vi.fn(async () => ({
        GET: page({
          render: { mode: "streaming" },
          view: () => <main>Streaming dev</main>,
        }),
      })),
      transformIndexHtml,
      watcher: createWatcherHarness(),
    };

    await mkdir(routesDir, { recursive: true });
    await writeFile(join(routesDir, "index.tsx"), "export {}");
    plugin.configureServer?.(server as never);

    const response = new CapturingResponse();
    await middleware.handler(
      requestFor("/", { headers: { accept: "text/html", host: "example.test" } }) as never,
      response as never,
      vi.fn(),
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("/@vite/client");
    expect(response.body).toContain("/@id/virtual:demiurge/client-entry");
    expect(response.body).toContain("Streaming dev");
    expect(response.body).toContain("</html>");
    expect(transformIndexHtml).toHaveBeenCalledOnce();
  });

  it("renders the built-in not-found document for HTML navigation misses", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-vite-missing-document-"));
    const routesDir = join(root, "routes");
    const plugin = demiurge({ routesDir: "routes" }) as PluginHarness;
    const middleware = createMiddlewareHarness();
    const server = {
      config: { root },
      middlewares: {
        use: middleware.use,
      },
      ssrLoadModule: vi.fn(),
      transformIndexHtml: vi.fn(async (_url: string, html: string) => html),
      watcher: createWatcherHarness(),
    };

    await mkdir(routesDir, { recursive: true });

    plugin.configureServer?.(server as never)?.();

    const next = vi.fn();
    const routeResponse = new CapturingResponse();
    await middleware.handler(
      requestFor("/missing", {
        headers: { accept: "text/html", host: "example.test" },
      }) as never,
      routeResponse as never,
      next,
    );

    // Nothing matched, so Vite gets its chance before the terminator runs.
    expect(next).toHaveBeenCalledWith();

    const response = new CapturingResponse();
    await middleware.notFoundHandler(
      requestFor("/missing", {
        headers: { accept: "text/html", host: "example.test" },
      }) as never,
      response as never,
      vi.fn(),
    );

    expect(response.statusCode).toBe(404);
    expect(response.body).toContain("/@id/virtual:demiurge/client-entry");
    expect(response.body).toContain('data-demiurge-fallback="not-found"');
    expect(response.body).toContain("404");
    expect(response.body).toContain("No route matched");
    expect(response.body).toContain("/missing");
  });

  it("renders server markup and a hydration bootstrap for a matched page route in Vite dev", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-vite-ssr-document-"));
    const routesDir = join(root, "routes");
    const plugin = demiurge({ routesDir: "routes" }) as PluginHarness;
    const middleware = createMiddlewareHarness();
    const server = {
      config: { root },
      middlewares: {
        use: middleware.use,
      },
      ssrLoadModule: vi.fn(async () => ({
        GET: page<string, { message: string }>({
          data: async () => ({ message: "Hello from the server" }),
          view: DevPage,
        }),
      })),
      transformIndexHtml: vi.fn(async (_url: string, html: string) => html),
      watcher: createWatcherHarness(),
    };

    await mkdir(routesDir, { recursive: true });
    await writeFile(join(routesDir, "index.tsx"), "export {}");

    plugin.configureServer?.(server as never);

    const response = new CapturingResponse();
    await middleware.handler(
      requestFor("/", {
        headers: {
          accept: "text/html",
          host: "example.test",
        },
      }) as never,
      response as never,
      vi.fn(),
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Hello from the server");
    expect(response.body).toContain('data-demiurge-hydrate=""');
    expect(response.body).toContain('id="__demiurge_data"');
    expect(response.body).toContain(
      'src="/@id/virtual:demiurge/client-entry"',
    );
  });

  it("includes server-resolved route data in the dev document bootstrap payload", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-vite-ssr-data-"));
    const routesDir = join(root, "routes");
    const plugin = demiurge({ routesDir: "routes" }) as PluginHarness;
    const middleware = createMiddlewareHarness();
    const server = {
      config: { root },
      middlewares: {
        use: middleware.use,
      },
      ssrLoadModule: vi.fn(async () => ({
        GET: page<string, { message: string }>({
          data: async () => ({ message: "loader payload" }),
          view: DevPage,
        }),
      })),
      transformIndexHtml: vi.fn(async (_url: string, html: string) => html),
      watcher: createWatcherHarness(),
    };

    await mkdir(routesDir, { recursive: true });
    await writeFile(join(routesDir, "index.tsx"), "export {}");

    plugin.configureServer?.(server as never);

    const response = new CapturingResponse();
    await middleware.handler(
      requestFor("/", {
        headers: {
          accept: "text/html",
          host: "example.test",
        },
      }) as never,
      response as never,
      vi.fn(),
    );

    expect(response.body).toContain('"data":{"message":"loader payload"}');
    expect(response.body).toContain('"hasData":true');
  });

  it("emits a bodiless static shell, styles, and a production manifest", () => {
    const plugin = demiurge() as PluginHarness;

    if (!plugin.generateBundle) {
      throw new Error("generateBundle was not registered.");
    }

    const emitFile = vi.fn();
    const bundle = {
      "assets/app.js": {
        facadeModuleId: "\0virtual:demiurge/client-entry",
        fileName: "assets/app.js",
        isEntry: true,
        type: "chunk",
      },
      "assets/app.css": {
        fileName: "assets/app.css",
        source: "body {}",
        type: "asset",
      },
    };

    plugin.generateBundle.call({ emitFile }, {} as never, bundle as never);

    expect(emitFile).toHaveBeenCalledTimes(2);
    const emitted = emitFile.mock.calls.map(([asset]) => asset);
    const html = emitted.find((asset) => asset.fileName === "index.html");
    const manifest = emitted.find(
      (asset) => asset.fileName === "demiurge-manifest.json",
    );
    expect(html).toBeDefined();
    expect(manifest).toBeDefined();
    expect(html?.source).toContain('<div id="root"></div>');
    expect(html?.source).not.toContain("data-demiurge-hydrate");
    expect(html?.source).not.toContain("__demiurge_data");
    expect(html?.source).toContain('src="/assets/app.js"');
    expect(html?.source).toContain(
      '<link rel="stylesheet" href="/assets/app.css" />',
    );
    expect(JSON.parse(manifest?.source ?? "{}")).toEqual({
      clientEntry: "/assets/app.js",
      styles: ["/assets/app.css"],
    });
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

  it("uses default route and typed-output directories in dev", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-vite-defaults-"));
    const routesDir = join(root, "src", "routes");
    const outputFile = join(root, ".demiurge", "route-manifest.d.ts");
    const plugin = demiurge({ typedRoutes: {} }) as PluginHarness;
    const watcher = createWatcherHarness();
    const middleware = createMiddlewareHarness();
    const server = {
      config: { root },
      middlewares: { use: middleware.use },
      ssrLoadModule: vi.fn(),
      transformIndexHtml: vi.fn(async (_url: string, html: string) => html),
      watcher,
    };

    await mkdir(routesDir, { recursive: true });
    plugin.configureServer?.(server as never)?.();

    expect(watcher.add).toHaveBeenCalledWith(routesDir);
    await expect(readTextEventually(outputFile)).resolves.toContain(
      "interface RoutePathVars",
    );

    const request = requestFor("/missing", {
      headers: { accept: "text/html", host: "example.test" },
    });
    await middleware.handler(
      request as never,
      new CapturingResponse() as never,
      vi.fn(),
    );

    const response = new CapturingResponse();
    await middleware.notFoundHandler(
      request as never,
      response as never,
      vi.fn(),
    );

    expect(response.statusCode).toBe(404);
  });

  it("renders a dev error document when a route module fails to load", async () => {
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
      transformIndexHtml: vi.fn(async (_url: string, html: string) => html),
      watcher: createWatcherHarness(),
    };

    await mkdir(routesDir, { recursive: true });
    await writeFile(join(routesDir, "api.tsx"), "export {}");

    plugin.configureServer?.(server as never);

    const next = vi.fn();
    const response = new CapturingResponse();
    await middleware.handler(
      requestFor("/api", {
        headers: { accept: "text/html", host: "example.test" },
      }) as never,
      response as never,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(500);
    // Dev is the one place the stack belongs in the body.
    expect(response.body).toContain("load failed");
    expect(response.body).toContain("/api");
    expect(response.body).toContain("<pre>");
    expect(response.body).toContain("plugin.test.tsx");
  });
});

describe("Vite plugin document runtime", () => {
  it("creates an escaped framework-owned document", () => {
    const html = unstable_createDocumentHtml({
      entrySrc: "/assets/app.js",
      lang: 'en" data-test="bad',
      title: "Demiurge <Blog>",
    });

    expect(html).toContain('<html lang="en&quot; data-test=&quot;bad">');
    expect(html).toContain("<title>Demiurge &lt;Blog&gt;</title>");
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('<script type="module" src="/assets/app.js"></script>');
  });

  it("renders resolved document metadata, links, and scripts", () => {
    const html = unstable_createDocumentHtml({
      entrySrc: "/assets/app.js",
      links: [
        preconnect("https://api.example.com", { crossOrigin: "anonymous" }),
        preload("/hero.avif", { as: "image", type: "image/avif" }),
        modulePreload("/assets/editor.js"),
      ],
      metadata: resolveMetadata(
        defineMetadata({
          canonical: "/checkout",
          custom: [
            meta({ content: "#fff", name: "theme-color" }),
            link({ href: "/feed.xml", rel: "alternate" }),
          ],
          description: "Complete your order.",
          openGraph: {
            image: "/og.png",
          },
          robots: {
            follow: false,
            index: false,
          },
          structuredData: [
            structuredData({
              "@context": "https://schema.org",
              "@type": "Article",
              headline: "Checkout </script>",
            }),
          ],
          title: "Checkout <Secure>",
        }),
      ),
      nonce: "doc-nonce",
      scripts: [
        script({
          async: true,
          integrity: "sha384-demo",
          nonce: "abc123",
          src: "https://cdn.example.com/app.js",
        }),
        script({
          src: "/assets/module.js",
          strategy: "module",
        }),
      ],
    });

    expect(html).toContain("<title>Checkout &lt;Secure&gt;</title>");
    expect(html).toContain(
      '<meta name="description" content="Complete your order." />',
    );
    expect(html).toContain('<link rel="canonical" href="/checkout" />');
    expect(html).toContain(
      '<meta name="robots" content="noindex, nofollow" />',
    );
    expect(html).toContain(
      '<meta property="og:title" content="Checkout &lt;Secure&gt;" />',
    );
    expect(html).toContain('<meta property="og:image" content="/og.png" />');
    expect(html).toContain('<meta name="theme-color" content="#fff" />');
    expect(html).toContain('<link rel="alternate" href="/feed.xml" />');
    expect(html).toContain(
      '<script type="application/ld+json" nonce="doc-nonce">{"@context":"https://schema.org","@type":"Article","headline":"Checkout \\u003c/script\\u003e"}</script>',
    );
    expect(html).toContain(
      '<link rel="preconnect" href="https://api.example.com" crossorigin="anonymous" />',
    );
    expect(html).toContain(
      '<link rel="preload" href="/hero.avif" as="image" type="image/avif" />',
    );
    expect(html).toContain(
      '<link rel="modulepreload" href="/assets/editor.js" />',
    );
    expect(html).toContain(
      '<script src="https://cdn.example.com/app.js" nonce="abc123" integrity="sha384-demo" async></script>',
    );
    expect(html).toContain(
      '<script src="/assets/module.js" type="module" nonce="doc-nonce"></script>',
    );
    expect(html).toContain(
      '<script type="module" src="/assets/app.js" nonce="doc-nonce"></script>',
    );
  });

  it("applies a document nonce to framework-managed scripts", () => {
    const html = unstable_createDocumentHtml({
      entrySrc: "/assets/app.js",
      nonce: "doc-nonce",
      scripts: [
        script({
          src: "https://cdn.example.com/app.js",
        }),
        script({
          nonce: "script-nonce",
          src: "https://cdn.example.com/explicit.js",
        }),
      ],
    });

    expect(html).toContain(
      '<script src="https://cdn.example.com/app.js" nonce="doc-nonce"></script>',
    );
    expect(html).toContain(
      '<script src="https://cdn.example.com/explicit.js" nonce="script-nonce"></script>',
    );
    expect(html).toContain(
      '<script type="module" src="/assets/app.js" nonce="doc-nonce"></script>',
    );
  });

  it("creates a virtual client entry from route files and app-owned styles", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-vite-client-entry-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "styles.css"), "body {}");

    const source = unstable_createClientEntrySource(root);

    expect(source).toContain('import "/src/styles.css";');
    expect(source).toContain('"/src/routes/**/*.{ts,tsx}"');
    expect(source).toContain('const routePrefix = "/src/routes/";');
    expect(source).toContain("./routes/");
    expect(source).toContain("hydrateFileRouter({ routes })");
  });

  it("omits the virtual style import when styles are disabled", () => {
    const source = unstable_createClientEntrySource("/tmp/none", {
      styles: false,
    });

    expect(source).not.toContain(".css");
  });

  it("creates a virtual server entry with normalized routes and SSR defaults", () => {
    const source = unstable_createServerEntrySource("/tmp/app", {
      document: {
        lang: "en-GB",
        title: "Server app",
      },
      routesDir: "src/pages",
    });

    expect(source).toContain('import.meta.glob(["/src/pages/**/*.{ts,tsx}"])');
    expect(source).toContain('const routePrefix = "/src/pages/";');
    expect(source).toContain("export const routes");
    expect(source).toContain("createRequestHandler");
    expect(source).toContain('lang ?? "en-GB"');
    expect(source).toContain('title ?? "Server app"');
  });

  it("includes framework-attached .ts files in the server entry", () => {
    // @policy.ts and @middleware.ts use the .ts extension. A .tsx-only glob
    // omits them from the production route map. Development finds both
    // extensions and still applies the files. Pipeline unification prevents
    // this difference.
    const source = unstable_createServerEntrySource("/tmp/app");

    expect(source).toContain('"/src/routes/**/*.{ts,tsx}"');
    expect(source).not.toContain("!");
  });

  it("keeps server-only route files out of the client entry", () => {
    // The client never runs a policy or middleware. A client glob would create
    // public chunks under dist/client. These chunks could expose values from
    // closures, including credentials.
    const source = unstable_createClientEntrySource("/tmp/app");

    expect(source).toContain('"!/src/routes/@policy.ts"');
    expect(source).toContain('"!/src/routes/**/@policy.ts"');
    expect(source).toContain('"!/src/routes/@middleware.ts"');
    expect(source).toContain('"!/src/routes/**/@middleware.ts"');
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

type DevMiddleware = (
  request: unknown,
  response: unknown,
  next: (error?: unknown) => void,
) => Promise<void>;

function createMiddlewareHarness() {
  const handlers: DevMiddleware[] = [];

  return {
    // The route handler runs before the Vite middleware. The not-found
    // terminator runs after them, registered from the hook `configureServer`
    // returns.
    get handler() {
      const [first] = handlers;

      if (!first) {
        throw new Error("Middleware was not registered.");
      }

      return first;
    },
    get notFoundHandler() {
      const last = handlers.at(-1);

      if (!last || handlers.length < 2) {
        throw new Error("Not-found middleware was not registered.");
      }

      return last;
    },
    use(nextHandler: DevMiddleware) {
      handlers.push(nextHandler);
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

async function hmacSignature(body: string, secret: string) {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      hash: "SHA-256",
      name: "HMAC",
    },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );

  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

describe("the root not-found build gate", () => {
  async function scaffold(files: Record<string, string>) {
    const root = await mkdtemp(join(tmpdir(), "demiurge-not-found-gate-"));

    for (const [name, source] of Object.entries(files)) {
      const file = join(root, "src", "routes", name);

      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, source);
    }

    return root;
  }

  const pageRoute = `import { page } from "@demiurgejs/core";
export const GET = page({ view: () => null });
`;

  it("fails a build when the app has page routes and no root @not-found", async () => {
    const root = await scaffold({ "index.tsx": pageRoute });

    await expect(unstable_assertRootNotFoundRoute(root)).rejects.toThrow(
      /src\/routes\/@not-found\.tsx/,
    );
    // The message has to name the file to create and the route that triggered
    // the gate, or it is just a build that stopped.
    await expect(unstable_assertRootNotFoundRoute(root)).rejects.toThrow(
      /"index\.tsx" declares a page/,
    );
  });

  it("passes once the app owns a root @not-found", async () => {
    const root = await scaffold({
      "@not-found.tsx": "export default function NotFound() { return null; }\n",
      "index.tsx": pageRoute,
    });

    await expect(unstable_assertRootNotFoundRoute(root)).resolves.toBeUndefined();
  });

  // Pagination is everywhere in API code, and an API-only app must never be
  // told to write a 404 document it will never serve. The gate keys on the
  // demiurge import, so none of these count as page routes.
  it.each([
    ["a pagination call", 'import { json } from "@demiurgejs/core";\nexport const GET = json(db.users.page(2));'],
    ["a page helper from elsewhere", 'import { page } from "./paginate";\nexport const GET = json(page(req));'],
    ["the word in a comment", '// backs the page(1) endpoint\nexport const GET = json([]);'],
    ["the word in a string", 'export const GET = json({ hint: "call page(n)" });'],
    ["a type-only import", 'import type { page } from "@demiurgejs/core";\nexport const GET = json([]);'],
  ])("does not read %s as a page route", (_label, source) => {
    expect(unstable_declaresPageRoute(source)).toBe(false);
  });

  it.each([
    ["a plain call", 'import { page } from "@demiurgejs/core";\nexport const GET = page({ view: Home });'],
    ["an aliased import", 'import { page as definePage } from "@demiurgejs/core";\nexport const GET = definePage({ view: Home });'],
    ["a mixed import", 'import { json, page, text } from "@demiurgejs/core";\nexport const GET = page({ view: Home });'],
  ])("reads %s as a page route", (_label, source) => {
    expect(unstable_declaresPageRoute(source)).toBe(true);
  });

  // A view can be imported rather than declared inline, which leaves a page
  // route in a plain .ts file. Detecting on extension would miss it and let a
  // page app build with the framework 404.
  it("finds a page route declared in a .ts file", async () => {
    const root = await scaffold({
      "dashboard.ts": `import { page } from "@demiurgejs/core";
import { DashboardView } from "../views/dashboard";
export const GET = page({ view: DashboardView });
`,
    });

    await expect(unstable_assertRootNotFoundRoute(root)).rejects.toThrow(
      /dashboard\.ts/,
    );
  });

  // Nagging an app that never wants an HTML document would be user hostile.
  it("stays quiet for an API-only app", async () => {
    const root = await scaffold({
      "api/health.ts": `import { json } from "@demiurgejs/core";
export const GET = json({ ok: true });
`,
      "api/widgets.tsx": `import { json } from "@demiurgejs/core";
import { db } from "../db";
export const GET = json(() => db.widgets.page(2));
`,
    });

    await expect(unstable_assertRootNotFoundRoute(root)).resolves.toBeUndefined();
  });

  it("finds a page route nested below the routes root", async () => {
    const root = await scaffold({ "blog/[slug].tsx": pageRoute });

    await expect(unstable_assertRootNotFoundRoute(root)).rejects.toThrow(
      /blog\/\[slug\]\.tsx/,
    );
  });

  it("stays quiet when the app has no routes directory at all", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-not-found-empty-"));

    await expect(unstable_assertRootNotFoundRoute(root)).resolves.toBeUndefined();
  });

  it("honours a custom routesDir", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-not-found-custom-"));
    const routesDir = join(root, "app", "pages");

    await mkdir(routesDir, { recursive: true });
    await writeFile(join(routesDir, "index.tsx"), pageRoute);

    await expect(
      unstable_assertRootNotFoundRoute(root, { routesDir: "app/pages" }),
    ).rejects.toThrow(/app\/pages\/@not-found\.tsx/);
  });

  it("runs from buildStart only for a build", async () => {
    const root = await scaffold({ "index.tsx": pageRoute });
    const plugin = demiurge() as PluginHarness;

    plugin.configResolved?.({ command: "serve", root } as never);
    await expect(plugin.buildStart?.()).resolves.toBeUndefined();

    plugin.configResolved?.({ command: "build", root } as never);
    await expect(plugin.buildStart?.()).rejects.toThrow(/@not-found\.tsx/);
  });
});
