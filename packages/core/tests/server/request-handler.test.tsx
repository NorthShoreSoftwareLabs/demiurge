import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  action,
  createMemoryCacheStore,
  createMemoryIdempotencyStore,
  createRequestHandler,
  defineLinks,
  defineAdapter,
  defineMetadata,
  defineRoutePolicy,
  defineScripts,
  json,
  jsonl,
  page,
  preconnect,
  preload,
  redirect,
  resolveMetadata,
  response as rawResponse,
  security,
  Script,
  script,
  serverTiming,
  sse,
  stream,
  text,
  webhook,
  type LayoutProps,
  type CacheScope,
  type RouteModule,
  type RouteProps,
} from "@demiurgejs/core";
import { renderPageDocument } from "../../src/server";

function View(_props: RouteProps) {
  return <main>Hello SSR</main>;
}

function Layout({ children }: LayoutProps) {
  return <section>Layout: {children}</section>;
}

function DataView({ data }: RouteProps<string, { headline: string }>) {
  return <main>{data.headline}</main>;
}

function CacheScopeView({
  data,
}: RouteProps<string, { scope: CacheScope; value: string }>) {
  return <main data-scope={data.scope}>{data.value}</main>;
}

function routeModule(module: RouteModule) {
  return vi.fn(async () => module);
}

describe("request handler", () => {
  it("invalidates declared action tags and strips the transport header", async () => {
    const store = createMemoryCacheStore();
    const invalidateTags = vi.spyOn(store, "invalidateTags");
    const revalidate = vi.fn(() => [{ id: "posts" }] as const);
    const routeModules = {
      "./routes/posts.ts": {
        POST: action({
          revalidate,
          handler: () => new Response("updated"),
        }),
      },
    } satisfies Record<string, RouteModule>;
    const handler = createRequestHandler({
      cacheStore: {
        namespace: { app: "test", environment: "test", schemaVersion: 1 },
        store,
      },
      routeModules,
      routes: Object.fromEntries(
        Object.entries(routeModules).map(([file, module]) => [
          file,
          routeModule(module),
        ]),
      ),
    });

    const response = await handler(
      new Request("https://example.test/posts", { method: "POST" }),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("updated");
    expect(response.headers.has("x-demiurge-revalidate-tags")).toBe(false);
    expect(invalidateTags).toHaveBeenCalledTimes(1);
    expect(invalidateTags.mock.calls[0]?.[0]).toEqual([
      "test:test:1:build:tag:posts",
      "test:test:1:private:tag:posts",
      "test:test:1:public:tag:posts",
    ]);
  });

  it("does not invalidate tags when an action fails", async () => {
    const store = createMemoryCacheStore();
    const invalidateTags = vi.spyOn(store, "invalidateTags");
    const revalidate = vi.fn(() => [{ id: "posts" }] as const);
    const routeModules = {
      "./routes/posts.ts": {
        POST: action({
          revalidate,
          handler: () => {
            throw new Error("failed");
          },
        }),
      },
    } satisfies Record<string, RouteModule>;
    const handler = createRequestHandler({
      cacheStore: {
        namespace: { app: "test", environment: "test", schemaVersion: 1 },
        store,
      },
      routeModules,
      routes: Object.fromEntries(
        Object.entries(routeModules).map(([file, module]) => [
          file,
          routeModule(module),
        ]),
      ),
    });

    await handler(new Request("https://example.test/posts", { method: "POST" }));

    expect(invalidateTags).not.toHaveBeenCalled();
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("does not repeat invalidation for an idempotent replay", async () => {
    const store = createMemoryCacheStore();
    const invalidateTags = vi.spyOn(store, "invalidateTags");
    const idempotency = createMemoryIdempotencyStore();
    const revalidate = vi.fn(() => [{ id: "posts" }] as const);
    const routeModules = {
      "./routes/posts.ts": {
        POST: action({
          idempotency: { key: ["create", "one"], store: idempotency },
          revalidate,
          handler: () => new Response("created"),
        }),
      },
    } satisfies Record<string, RouteModule>;
    const handler = createRequestHandler({
      cacheStore: {
        namespace: { app: "test", environment: "test", schemaVersion: 1 },
        store,
      },
      routeModules,
      routes: Object.fromEntries(
        Object.entries(routeModules).map(([file, module]) => [
          file,
          routeModule(module),
        ]),
      ),
    });

    await handler(new Request("https://example.test/posts", { method: "POST" }));
    await handler(new Request("https://example.test/posts", { method: "POST" }));

    expect(invalidateTags).toHaveBeenCalledTimes(1);
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("coordinates mutation invalidation with document and data navigation", async () => {
    let value = "before";
    let signalActionStarted!: () => void;
    const actionStarted = new Promise<void>((resolve) => {
      signalActionStarted = resolve;
    });
    let releaseAction!: () => void;
    const actionRelease = new Promise<void>((resolve) => {
      releaseAction = resolve;
    });
    const store = createMemoryCacheStore();
    const routeModules = {
      "./routes/index.tsx": {
        GET: page({
          data: ({ cache }) => cache.get({
            fn: () => value,
            key: ["value"],
            scope: "public",
            tags: [{ id: "value" }],
            ttl: "1h",
          }),
          view: ({ data }) => <main>{data}</main>,
        }),
        POST: action({
          revalidate: [{ id: "value" }],
          handler: async () => {
            signalActionStarted();
            value = "after";
            await actionRelease;
            return new Response("updated");
          },
        }),
      },
      "./routes/@not-found.tsx": { default: () => <main>Missing</main> },
    } satisfies Record<string, RouteModule>;
    const handler = createRequestHandler({
      cacheStore: {
        namespace: { app: "test", environment: "test", schemaVersion: 1 },
        store,
      },
      routeModules,
      routes: Object.fromEntries(
        Object.entries(routeModules).map(([file, module]) => [
          file,
          routeModule(module),
        ]),
      ),
    });

    const primed = await handler(new Request("https://example.test/", {
      headers: { "x-demiurge-navigation": "data" },
    }));
    await expect(primed.json()).resolves.toMatchObject({ data: "before" });

    const mutation = handler(
      new Request("https://example.test/", { method: "POST" }),
    );
    await actionStarted;
    const documentNavigation = handler(new Request("https://example.test/"));
    const browserNavigation = handler(new Request("https://example.test/", {
      headers: { "x-demiurge-navigation": "data" },
    }));
    const [documentResponse, browserResponse] = await Promise.all([
      documentNavigation,
      browserNavigation,
    ]);
    await expect(documentResponse.text()).resolves.toContain("before");
    await expect(browserResponse.json()).resolves.toMatchObject({
      data: "before",
    });
    releaseAction();
    await mutation;

    const refreshed = await handler(new Request("https://example.test/", {
      headers: { "x-demiurge-navigation": "data" },
    }));
    await expect(refreshed.json()).resolves.toMatchObject({ data: "after" });
  });

  it("validates eager route modules during handler construction", () => {
    const routeModules = {
      "./routes/api.ts": {
        POST: json({}, {
          cors: { credentials: true, origins: "*" },
        }),
      },
    } satisfies Record<string, RouteModule>;

    expect(() =>
      createRequestHandler({
        routeModules,
        routes: Object.fromEntries(
          Object.entries(routeModules).map(([file, module]) => [
            file,
            routeModule(module),
          ]),
        ),
      })
    ).toThrow(
      'Route "./routes/api.ts" export POST has an invalid CORS policy.',
    );
  });

  it("validates the effective CSP against an explicit adapter", () => {
    const routeModules = {
      "./routes/@policy.ts": {
        policy: defineRoutePolicy({ document: security.strict() }),
      },
      "./routes/index.tsx": { GET: page(View) },
    } satisfies Record<string, RouteModule>;

    expect(() =>
      createRequestHandler({
        adapter: defineAdapter({ name: "test-static" }),
        routeModules,
        routes: Object.fromEntries(
          Object.entries(routeModules).map(([file, module]) => [
            file,
            routeModule(module),
          ]),
        ),
      })
    ).toThrow(/nonceInjection/);
  });

  it("reports a blocked static script with its route and effective directive", () => {
    const routeModules = {
      "./routes/@policy.ts": {
        policy: defineRoutePolicy({ document: security.static() }),
      },
      "./routes/index.tsx": {
        GET: page({ render: { mode: "ssr" }, view: View }),
        scripts: defineScripts([
          script({ src: "https://cdn.example.com/app.js" }),
        ]),
      },
    } satisfies Record<string, RouteModule>;

    expect(() =>
      createRequestHandler({
        routeModules,
        routes: Object.fromEntries(
          Object.entries(routeModules).map(([file, module]) => [
            file,
            routeModule(module),
          ]),
        ),
      })
    ).toThrow(
      /Route "\.\/routes\/index\.tsx" export GET declares script "https:\/\/cdn\.example\.com\/app\.js" that violates the effective script-src 'self' policy\./,
    );
  });

  it("returns JSON route responses", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/health.tsx": routeModule({
          GET: json({ ok: true }),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/health"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("provides path and search context to response helpers", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/posts/[slug].tsx": routeModule({
          GET: json(({ path, search }) => ({
            preview: search.get("preview"),
            slug: path.slug,
          })),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/posts/hello?preview=1"),
    );

    await expect(response.json()).resolves.toEqual({
      preview: "1",
      slug: "hello",
    });
  });

  it("returns redirects", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/old-blog.tsx": routeModule({
          GET: redirect("/blog", 301),
        }),
      },
    });

    const response = await handler(new Request("https://example.test/old-blog"));

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/blog");
  });

  it("falls back from HEAD to GET without a body", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/health.tsx": routeModule({
          GET: text("ok"),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/health", {
        method: "HEAD",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    await expect(response.text()).resolves.toBe("");
  });

  it("serves server-sent event responses", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/events.tsx": routeModule({
          GET: sse(
            async function* events() {
              yield { event: "ready", data: "ok" };
            },
            {
              cors: {
                origins: ["https://app.example.com"],
              },
              timing: { duration: 2, name: "events" },
            },
          ),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/events", {
        headers: {
          origin: "https://app.example.com",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/event-stream; charset=utf-8",
    );
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.com",
    );
    expect(response.headers.get("server-timing")).toBe("events;dur=2");
    await expect(response.text()).resolves.toBe("event: ready\ndata: ok\n\n");
  });

  it("serves JSON Lines responses", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/feed.tsx": routeModule({
          GET: jsonl(
            async function* lines() {
              yield { id: 1 };
              yield { id: 2 };
            },
            {
              cors: {
                origins: ["https://app.example.com"],
              },
              timing: { duration: 3, name: "feed" },
            },
          ),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/feed", {
        headers: {
          origin: "https://app.example.com",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/x-ndjson; charset=utf-8",
    );
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.com",
    );
    expect(response.headers.get("server-timing")).toBe("feed;dur=3");
    await expect(response.text()).resolves.toBe('{"id":1}\n{"id":2}\n');
  });

  it("serves generic stream responses", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/download.tsx": routeModule({
          GET: stream(
            async function* body() {
              yield "hello ";
              yield new TextEncoder().encode("world");
            },
            {
              cors: {
                origins: ["https://app.example.com"],
              },
              headers: {
                "content-type": "text/plain; charset=utf-8",
              },
              timing: { duration: 5, name: "download" },
            },
          ),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/download", {
        headers: {
          origin: "https://app.example.com",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.com",
    );
    expect(response.headers.get("server-timing")).toBe("download;dur=5");
    await expect(response.text()).resolves.toBe("hello world");
  });

  it("strips server-sent event bodies for HEAD requests", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/events.tsx": routeModule({
          GET: sse(["ready"]),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/events", {
        method: "HEAD",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/event-stream; charset=utf-8",
    );
    await expect(response.text()).resolves.toBe("");
  });

  it("adds Server-Timing headers to route responses", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/health.tsx": routeModule({
          GET: json(
            { ok: true },
            {
              timing: serverTiming(
                { duration: 7.25, name: "db", description: "database" },
                { name: "cache" },
              ),
            },
          ),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/health"),
    );

    expect(response.headers.get("server-timing")).toBe(
      'db;dur=7.25;desc="database", cache',
    );
  });

  it("appends route Server-Timing to raw response timing headers", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/health.tsx": routeModule({
          GET: rawResponse(
            new Response("ok", {
              headers: {
                "server-timing": "app;dur=3",
              },
            }),
            {
              timing: { duration: 1, name: "framework" },
            },
          ),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/health"),
    );

    expect(response.headers.get("server-timing")).toBe(
      "app;dur=3, framework;dur=1",
    );
  });

  it("reports invalid Server-Timing metrics as a route failure", async () => {
    const nameError = vi.fn();
    const durationError = vi.fn();
    const invalidNameHandler = createRequestHandler({
      onError: nameError,
      routes: {
        "./routes/api/health.tsx": routeModule({
          GET: json({ ok: true }, { timing: { name: "bad name" } }),
        }),
      },
    });
    const invalidDurationHandler = createRequestHandler({
      onError: durationError,
      routes: {
        "./routes/api/health.tsx": routeModule({
          GET: json({ ok: true }, { timing: { duration: -1, name: "db" } }),
        }),
      },
    });

    const invalidNameResponse = await invalidNameHandler(
      new Request("https://example.test/api/health"),
    );
    const invalidDurationResponse = await invalidDurationHandler(
      new Request("https://example.test/api/health"),
    );

    expect(invalidNameResponse.status).toBe(500);
    expect(invalidNameResponse.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    await expect(invalidNameResponse.json()).resolves.toEqual({
      instance: "/api/health",
      status: 500,
      title: "Internal Server Error",
      type: "about:blank",
    });
    expect(invalidDurationResponse.status).toBe(500);
    expect(nameError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Server-Timing metric name "bad name" is not a valid token.',
      }),
      { pathname: "/api/health", site: "route" },
    );
    expect(durationError).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Server-Timing metric duration must be a non-negative finite number.",
      }),
      { pathname: "/api/health", site: "route" },
    );
  });

  it("returns method-not-allowed for missing method capabilities", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/health.tsx": routeModule({
          GET: json({ ok: true }),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/health", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });

  it("adds CORS headers to matching route responses", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/health.tsx": routeModule({
          GET: json(
            { ok: true },
            {
              cors: {
                credentials: true,
                origins: ["https://app.example.com"],
              },
            },
          ),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/health", {
        headers: {
          origin: "https://app.example.com",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.com",
    );
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("generates CORS preflight responses from route policy", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/posts.tsx": routeModule({
          POST: json(
            { ok: true },
            {
              cors: {
                headers: ["content-type"],
                maxAge: 300,
                methods: ["POST"],
                origins: ["https://app.example.com"],
              },
            },
          ),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/posts", {
        headers: {
          "access-control-request-method": "POST",
          origin: "https://app.example.com",
        },
        method: "OPTIONS",
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.com",
    );
    expect(response.headers.get("access-control-allow-methods")).toBe("POST");
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "content-type",
    );
    expect(response.headers.get("access-control-max-age")).toBe("300");
  });

  it("falls back from HEAD to GET while preserving CORS headers", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/health.tsx": routeModule({
          GET: text("ok", {
            cors: {
              origins: ["https://app.example.com"],
            },
            headers: {
              vary: "Accept",
            },
          }),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/health", {
        headers: {
          origin: "https://app.example.com",
        },
        method: "HEAD",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.com",
    );
    expect(response.headers.get("vary")).toBe("Accept, Origin");
    await expect(response.text()).resolves.toBe("");
  });

  it("does not generate preflight responses for unsupported requested methods", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/posts.tsx": routeModule({
          POST: json(
            { ok: true },
            {
              cors: {
                methods: ["POST"],
                origins: ["https://app.example.com"],
              },
            },
          ),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/posts", {
        headers: {
          "access-control-request-method": "DELETE",
          origin: "https://app.example.com",
        },
        method: "OPTIONS",
      }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("rejects oversized request bodies before route handlers run", async () => {
    const handlerSpy = vi.fn(({ request }: { request: Request }) => request.text());
    const handler = createRequestHandler({
      routes: {
        "./routes/api/echo.tsx": routeModule({
          POST: text(handlerSpy, {
            security: {
              request: {
                maxBodySize: "4b",
              },
            },
          }),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/echo", {
        body: "hello",
        headers: {
          "content-length": "5",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.text()).resolves.toBe("Request body too large.");
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("counts chunked request bytes as handlers consume them", async () => {
    const handlerSpy = vi.fn(({ request }: { request: Request }) => request.text());
    const handler = createRequestHandler({
      routes: {
        "./routes/api/echo.tsx": routeModule({
          POST: text(handlerSpy, {
            cors: { origins: ["https://app.example.com"] },
            security: { request: { maxBodySize: "4b" } },
          }),
        }),
      },
    });
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("he"));
        controller.enqueue(encoder.encode("llo"));
        controller.close();
      },
    });
    const request = new Request("https://example.test/api/echo", {
      body,
      duplex: "half",
      headers: { origin: "https://app.example.com" },
      method: "POST",
    } as RequestInit);

    const response = await handler(request);

    expect(response.status).toBe(413);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.com",
    );
    await expect(response.text()).resolves.toBe("Request body too large.");
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it("counts actual bytes when Content-Length understates the body", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/echo.tsx": routeModule({
          POST: text(({ request }) => request.text(), {
            security: { request: { maxBodySize: "4b" } },
          }),
        }),
      },
    });
    const response = await handler(
      new Request("https://example.test/api/echo", {
        body: "hello",
        headers: { "content-length": "1" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.text()).resolves.toBe("Request body too large.");
  });

  it("rejects invalid declared content length for limited routes", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/echo.tsx": routeModule({
          POST: text(({ request }) => request.text(), {
            security: {
              request: {
                maxBodySize: 10,
              },
            },
          }),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/echo", {
        body: "hello",
        headers: {
          "content-length": "not-a-number",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("Invalid Content-Length.");
  });

  it("rejects methods disallowed by route request policy", async () => {
    const handlerSpy = vi.fn(() => "deleted");
    const handler = createRequestHandler({
      routes: {
        "./routes/api/profile.tsx": routeModule({
          DELETE: text(handlerSpy, {
            security: {
              request: {
                allowedMethods: ["POST"],
              },
            },
          }),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/profile", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("allows HEAD when route request policy allows GET", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/profile.tsx": routeModule({
          GET: text("ok", {
            security: {
              request: {
                allowedMethods: ["GET"],
              },
            },
          }),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/profile", {
        method: "HEAD",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("allow")).toBe(null);
    await expect(response.text()).resolves.toBe("");
  });

  it("keeps CORS headers on allowed-method rejections", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/profile.tsx": routeModule({
          DELETE: text("deleted", {
            cors: {
              origins: ["https://app.example.com"],
            },
            security: {
              request: {
                allowedMethods: ["POST"],
              },
            },
          }),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/profile", {
        headers: {
          origin: "https://app.example.com",
        },
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.com",
    );
  });

  it("rate limits route requests before route handlers run", async () => {
    const handlerSpy = vi.fn(() => "ok");
    const handler = createRequestHandler({
      routes: {
        "./routes/api/profile.tsx": routeModule({
          POST: text(handlerSpy, {
            security: {
              rateLimit: {
                key: {
                  header: "x-user-id",
                },
                limit: 1,
                window: "1m",
              },
            },
          }),
        }),
      },
    });
    const request = () =>
      new Request("https://example.test/api/profile", {
        headers: {
          "x-user-id": "demo",
        },
        method: "POST",
      });

    expect((await handler(request())).status).toBe(200);

    const response = await handler(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("x-ratelimit-limit")).toBe("1");
    expect(response.headers.get("x-ratelimit-remaining")).toBe("0");
    await expect(response.text()).resolves.toBe("Rate limit exceeded.");
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps CORS headers on rate limit rejections", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/profile.tsx": routeModule({
          POST: text("ok", {
            cors: {
              origins: ["https://app.example.com"],
            },
            security: {
              rateLimit: {
                key: {
                  header: "x-user-id",
                },
                limit: 1,
                window: "1m",
              },
            },
          }),
        }),
      },
    });
    const request = () =>
      new Request("https://example.test/api/profile", {
        headers: {
          origin: "https://app.example.com",
          "x-user-id": "demo",
        },
        method: "POST",
      });

    expect((await handler(request())).status).toBe(200);

    const response = await handler(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.com",
    );
  });

  it("keeps CORS headers on request size rejections", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/echo.tsx": routeModule({
          POST: text(({ request }) => request.text(), {
            cors: {
              origins: ["https://app.example.com"],
            },
            security: {
              request: {
                maxBodySize: 1,
              },
            },
          }),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/echo", {
        body: "hello",
        headers: {
          "content-length": "5",
          origin: "https://app.example.com",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.com",
    );
  });

  it("enforces inherited @policy files before route handlers run", async () => {
    const handlerSpy = vi.fn(({ request }: { request: Request }) => request.text());
    const handler = createRequestHandler({
      routes: {
        "./routes/@policy.ts": routeModule({
          policy: defineRoutePolicy({
            security: {
              request: {
                maxBodySize: "4b",
              },
            },
          }),
        }),
        "./routes/api/echo.tsx": routeModule({
          POST: text(handlerSpy),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/echo", {
        body: "hello",
        headers: {
          "content-length": "5",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.text()).resolves.toBe("Request body too large.");
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("generates document nonces only for CSP policies that require them", async () => {
    const createHandler = (document: ReturnType<typeof security.strict>) =>
      createRequestHandler({
        routes: {
          "./routes/@policy.ts": routeModule({
            policy: defineRoutePolicy({ document }),
          }),
          "./routes/index.tsx": routeModule({ GET: page(View) }),
        },
        ssr: { clientEntry: "/assets/app.js" },
      });
    const request = () => new Request("https://example.test/");
    const strictResponse = await createHandler(security.strict())(request());
    const staticResponse = await createHandler(security.static())(request());
    const strictHtml = await strictResponse.text();
    const staticHtml = await staticResponse.text();

    expect(strictResponse.headers.get("content-security-policy")).toMatch(
      /'nonce-[A-Za-z0-9+/=]+'/,
    );
    expect(strictResponse.headers.get("strict-transport-security")).toBe(
      "max-age=31536000",
    );
    expect(strictResponse.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(strictHtml).toMatch(/nonce="[A-Za-z0-9+/=]+"/);
    expect(staticResponse.headers.get("content-security-policy")).toContain(
      "script-src 'self'",
    );
    expect(staticResponse.headers.get("content-security-policy")).not.toContain(
      "nonce-",
    );
    expect(staticResponse.headers.has("cache-control")).toBe(false);
    expect(staticHtml).not.toContain(" nonce=");
  });

  it("overrides cacheable response directives on nonce-backed documents", async () => {
    const handler = createRequestHandler({
      renderPage: () =>
        new Response("<main>cached</main>", {
          headers: {
            "cache-control": "public, max-age=3600",
            "content-type": "text/html; charset=utf-8",
          },
        }),
      routes: {
        "./routes/@policy.ts": routeModule({
          policy: defineRoutePolicy({ document: security.strict() }),
        }),
        "./routes/index.tsx": routeModule({ GET: page(View) }),
      },
    });

    const response = await handler(new Request("https://example.test/"));

    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("scopes inherited @policy files to route group subtrees", async () => {
    const adminSpy = vi.fn(({ request }: { request: Request }) => request.text());
    const publicSpy = vi.fn(({ request }: { request: Request }) => request.text());
    const handler = createRequestHandler({
      routes: {
        "./routes/(admin)/@policy.ts": routeModule({
          policy: defineRoutePolicy({
            security: {
              request: {
                maxBodySize: "4b",
              },
            },
          }),
        }),
        "./routes/(admin)/admin-echo.tsx": routeModule({
          POST: text(adminSpy),
        }),
        "./routes/public-echo.tsx": routeModule({
          POST: text(publicSpy),
        }),
      },
    });

    const adminResponse = await handler(
      new Request("https://example.test/admin-echo", {
        body: "hello",
        headers: {
          "content-length": "5",
        },
        method: "POST",
      }),
    );
    const publicResponse = await handler(
      new Request("https://example.test/public-echo", {
        body: "hello",
        headers: {
          "content-length": "5",
        },
        method: "POST",
      }),
    );

    expect(adminResponse.status).toBe(413);
    expect(adminSpy).not.toHaveBeenCalled();
    expect(publicResponse.status).toBe(200);
    await expect(publicResponse.text()).resolves.toBe("hello");
    expect(publicSpy).toHaveBeenCalledTimes(1);
  });

  it("runs inherited @middleware files root-to-leaf around route handlers", async () => {
    const events: string[] = [];
    const handler = createRequestHandler({
      routes: {
        "./routes/@middleware.ts": routeModule({
          middleware: async (_context, next) => {
            events.push("root before");
            const response = await next();
            events.push("root after");
            response.headers.set("x-root", "1");
            return response;
          },
        }),
        "./routes/api/@middleware.ts": routeModule({
          middleware: async (_context, next) => {
            events.push("api before");
            const response = await next();
            events.push("api after");
            response.headers.set("x-api", "1");
            return response;
          },
        }),
        "./routes/api/health.tsx": routeModule({
          GET: text(() => {
            events.push("handler");
            return "ok";
          }),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/health"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-root")).toBe("1");
    expect(response.headers.get("x-api")).toBe("1");
    await expect(response.text()).resolves.toBe("ok");
    expect(events).toEqual([
      "root before",
      "api before",
      "handler",
      "api after",
      "root after",
    ]);
  });

  it("lets inherited @middleware short-circuit route handlers", async () => {
    const handlerSpy = vi.fn(() => "ok");
    const handler = createRequestHandler({
      routes: {
        "./routes/api/@middleware.ts": routeModule({
          middleware: ({ request }, next) => {
            if (!request.headers.has("authorization")) {
              return new Response("Unauthorized", { status: 401 });
            }

            return next();
          },
        }),
        "./routes/api/profile.tsx": routeModule({
          GET: text(handlerSpy),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/profile"),
    );

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("Unauthorized");
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("scopes inherited @middleware files to route group subtrees", async () => {
    const adminSpy = vi.fn(() => "admin");
    const publicSpy = vi.fn(() => "public");
    const handler = createRequestHandler({
      routes: {
        "./routes/(admin)/@middleware.ts": routeModule({
          middleware: () => new Response("Admin only", { status: 403 }),
        }),
        "./routes/(admin)/dashboard.tsx": routeModule({
          GET: text(adminSpy),
        }),
        "./routes/public.tsx": routeModule({
          GET: text(publicSpy),
        }),
      },
    });

    const adminResponse = await handler(
      new Request("https://example.test/dashboard"),
    );
    const publicResponse = await handler(
      new Request("https://example.test/public"),
    );

    expect(adminResponse.status).toBe(403);
    await expect(adminResponse.text()).resolves.toBe("Admin only");
    expect(adminSpy).not.toHaveBeenCalled();
    expect(publicResponse.status).toBe(200);
    await expect(publicResponse.text()).resolves.toBe("public");
    expect(publicSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects middleware that calls next more than once", async () => {
    const onError = vi.fn();
    const handler = createRequestHandler({
      onError,
      routes: {
        "./routes/@middleware.ts": routeModule({
          middleware: async (_context, next) => {
            await next();
            return await next();
          },
        }),
        "./routes/api/health.tsx": routeModule({
          GET: text("ok"),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/health"),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Demiurge route middleware next() called multiple times.",
      }),
      { pathname: "/api/health", site: "middleware" },
    );
  });

  it("rejects unsafe CSRF-protected requests without matching tokens", async () => {
    const handlerSpy = vi.fn(({ request }: { request: Request }) => request.text());
    const handler = createRequestHandler({
      routes: {
        "./routes/api/profile.tsx": routeModule({
          POST: text(handlerSpy, {
            security: {
              csrf: true,
            },
          }),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/profile", {
        body: "name=demo",
        headers: {
          cookie: "csrf-token=abc",
          "x-csrf-token": "wrong",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe("Invalid CSRF token.");
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("protects cookie-authenticated unsafe requests by default", async () => {
    const handlerSpy = vi.fn(() => "updated");
    const handler = createRequestHandler({
      routes: {
        "./routes/api/profile.tsx": routeModule({
          POST: text(handlerSpy),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/profile", {
        headers: { cookie: "session=authenticated" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe("Invalid CSRF token.");
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("accepts matching default tokens on cookie-authenticated unsafe requests", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/profile.tsx": routeModule({
          POST: text("updated"),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/profile", {
        headers: {
          cookie: "session=authenticated; csrf-token=token",
          "x-csrf-token": "token",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("updated");
  });

  it("allows tokenless unsafe API requests that carry no cookies", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/jobs.tsx": routeModule({
          POST: text("queued"),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/jobs", { method: "POST" }),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("queued");
  });

  it("supports an inherited explicit CSRF exemption", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/hooks/@policy.ts": routeModule({
          policy: defineRoutePolicy({ security: { csrf: false } }),
        }),
        "./routes/hooks/incoming.tsx": routeModule({
          POST: text("accepted"),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/hooks/incoming", {
        headers: { cookie: "delivery=context" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("accepted");
  });

  it("allows unsafe CSRF-protected requests with matching tokens", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/profile.tsx": routeModule({
          POST: text(({ request }) => request.text(), {
            security: {
              csrf: true,
            },
          }),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/profile", {
        body: "name=demo",
        headers: {
          cookie: "csrf-token=abc",
          "x-csrf-token": "abc",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("name=demo");
  });

  it("supports custom CSRF cookie and header names", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/profile.tsx": routeModule({
          PATCH: text("ok", {
            security: {
              csrf: {
                cookie: "demo-csrf",
                header: "x-demo-csrf",
              },
            },
          }),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/profile", {
        headers: {
          cookie: "demo-csrf=token",
          "x-demo-csrf": "token",
        },
        method: "PATCH",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ok");
  });

  it("does not enforce CSRF on safe methods", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/profile.tsx": routeModule({
          GET: text("ok", {
            security: {
              csrf: true,
            },
          }),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/profile"),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ok");
  });

  it("keeps CORS headers on CSRF rejections", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/profile.tsx": routeModule({
          POST: text("ok", {
            cors: {
              origins: ["https://app.example.com"],
            },
            security: {
              csrf: true,
            },
          }),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/profile", {
        body: "name=demo",
        headers: {
          origin: "https://app.example.com",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.com",
    );
  });

  it("verifies HMAC webhooks and preserves the raw body", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/webhook.tsx": routeModule({
          POST: webhook.hmac({
            handler: ({ rawBody, text }) => Response.json({
              bytes: [...rawBody],
              rawBody: text(),
            }),
            secret: "top-secret",
          }),
        }),
      },
    });
    const body = "{\"ok\":true}";
    const signature = await hmacSignature(body, "top-secret");

    const response = await handler(
      new Request("https://example.test/api/webhook", {
        body,
        headers: {
          cookie: "delivery=context",
          "x-webhook-signature": `sha256=${signature}`,
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      bytes: [...new TextEncoder().encode(body)],
      rawBody: body,
    });
  });

  it("verifies padded base64 HMAC signatures without truncating padding", async () => {
    const body = new Uint8Array([0xff, 0x00, 0x61, 0x80]);
    const signature = await hmacSignatureBytes(body, "top-secret", "base64");
    const handler = createRequestHandler({
      routes: {
        "./routes/api/webhook.tsx": routeModule({
          POST: webhook.hmac({
            encoding: "base64",
            handler: ({ rawBody }) => Response.json({ bytes: [...rawBody] }),
            secret: "top-secret",
          }),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/webhook", {
        body,
        headers: { "x-webhook-signature": signature },
        method: "POST",
      }),
    );

    expect(signature.endsWith("=")).toBe(true);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ bytes: [...body] });
  });

  it("supports explicit signature prefixes and rejects malformed encodings", async () => {
    const body = new TextEncoder().encode("payload");
    const signature = await hmacSignatureBytes(body, "top-secret", "base64");
    const handlerSpy = vi.fn(({ rawBody }: { rawBody: Uint8Array }) =>
      Response.json({ bytes: [...rawBody] }),
    );
    const handler = createRequestHandler({
      routes: {
        "./routes/api/webhook.tsx": routeModule({
          POST: webhook.hmac({
            encoding: "base64",
            handler: handlerSpy,
            prefix: "v1=",
            secret: "top-secret",
          }),
        }),
      },
    });
    const valid = await handler(
      new Request("https://example.test/api/webhook", {
        body,
        headers: { "x-webhook-signature": `v1=${signature}` },
        method: "POST",
      }),
    );
    const malformed = await handler(
      new Request("https://example.test/api/webhook", {
        body,
        headers: { "x-webhook-signature": "v1=%%%=" },
        method: "POST",
      }),
    );

    expect(valid.status).toBe(200);
    expect(malformed.status).toBe(401);
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects webhooks with missing or invalid HMAC signatures", async () => {
    const handlerSpy = vi.fn(() => Response.json({ ok: true }));
    const handler = createRequestHandler({
      routes: {
        "./routes/api/webhook.tsx": routeModule({
          POST: webhook.hmac({
            handler: handlerSpy,
            secret: "top-secret",
          }),
        }),
      },
    });

    const missingSignature = await handler(
      new Request("https://example.test/api/webhook", {
        body: "{}",
        method: "POST",
      }),
    );
    const invalidSignature = await handler(
      new Request("https://example.test/api/webhook", {
        body: "{}",
        headers: {
          "x-webhook-signature": "sha256=bad",
        },
        method: "POST",
      }),
    );

    expect(missingSignature.status).toBe(401);
    await expect(missingSignature.text()).resolves.toBe(
      "Missing webhook signature.",
    );
    expect(invalidSignature.status).toBe(401);
    await expect(invalidSignature.text()).resolves.toBe(
      "Invalid webhook signature.",
    );
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("returns not found for missing routes", async () => {
    const handler = createRequestHandler({ routes: {} });

    const response = await handler(new Request("https://example.test/missing"));

    expect(response.status).toBe(404);
  });

  it("returns a controlled 400 for malformed path encoding without reporting an app error", async () => {
    const onError = vi.fn();
    const handler = createRequestHandler({ onError, routes: {} });
    const response = await handler(
      new Request("https://example.test/bad/%", {
        headers: { accept: "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    await expect(response.json()).resolves.toMatchObject({
      status: 400,
      title: "Bad Request",
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it("renders page routes with SSR and an optional client entry", async () => {
    const handler = createRequestHandler({
      ssr: {
        clientEntry: "/assets/client.js",
      },
      routes: {
        "./routes/index.tsx": routeModule({
          metadata: {
            description: "Server rendered home",
            title: "Home",
          },
          GET: page(View),
        }),
      },
    });

    const response = await handler(new Request("https://example.test/"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    const html = await response.text();
    expect(html).toContain("<main>Hello SSR</main>");
    expect(html).toContain("<title>Home</title>");
    expect(html).toContain('name="description" content="Server rendered home"');
    expect(html).toContain('src="/assets/client.js"');
  });

  it("returns server-executed data for browser navigations without rendering HTML", async () => {
    const data = vi.fn(async ({ request }: { request: Request }) => ({
      headline: new URL(request.url).searchParams.get("headline") ?? "missing",
    }));
    const layoutLinks = vi.fn(({ search }: { search: URLSearchParams }) =>
      search.has("headline") ? [preconnect("https://layout.example.test")] : []
    );
    const pageScripts = vi.fn(({ search }: { search: URLSearchParams }) =>
      search.has("headline")
        ? [script({ src: "https://scripts.example.test/navigation.js" })]
        : []
    );
    const handler = createRequestHandler({
      routes: {
        "./routes/@layout.tsx": routeModule({
          default: Layout,
          links: defineLinks(layoutLinks),
        }),
        "./routes/index.tsx": routeModule({
          GET: page<string, { headline: string }>({ data, view: DataView }),
          metadata: defineMetadata({
            description: "Navigation description",
            title: "Navigation title",
          }),
          scripts: defineScripts(pageScripts),
        }),
      },
    });
    const response = await handler(
      new Request("https://example.test/?headline=Server", {
        headers: {
          accept: "application/json",
          "x-demiurge-navigation": "data",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-demiurge-navigation")).toBe("data");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toContain("x-demiurge-navigation");
    await expect(response.json()).resolves.toEqual({
      data: { headline: "Server" },
      document: {
        links: [{
          href: "https://layout.example.test",
          kind: "link",
          rel: "preconnect",
        }],
        metadata: expect.objectContaining({
          description: "Navigation description",
          title: "Navigation title",
        }),
        scripts: [{
          kind: "script",
          src: "https://scripts.example.test/navigation.js",
          strategy: "afterInteractive",
        }],
        title: "Navigation title",
      },
      hasData: true,
    });
    const historyResponse = await handler(
      new Request("https://example.test/?headline=History", {
        headers: {
          accept: "application/json",
          "x-demiurge-navigation": "data",
        },
      }),
    );
    await expect(historyResponse.json()).resolves.toEqual({
      data: { headline: "History" },
      document: expect.objectContaining({ title: "Navigation title" }),
      hasData: true,
    });
    expect(data).toHaveBeenCalledTimes(2);
    expect(layoutLinks).toHaveBeenCalledTimes(2);
    expect(pageScripts).toHaveBeenCalledTimes(2);
    expect(layoutLinks.mock.calls.map(([context]) =>
      context.search.get("headline")
    )).toEqual(["Server", "History"]);
    expect(pageScripts.mock.calls.map(([context]) =>
      context.search.get("headline")
    )).toEqual(["Server", "History"]);
  });

  it("marks navigation misses separately from route-data errors", async () => {
    const missingHandler = createRequestHandler({ routes: {} });
    const brokenHandler = createRequestHandler({
      routes: {
        "./routes/index.tsx": routeModule({
          GET: page({
            data: () => {
              throw new Error("private failure");
            },
            view: View,
          }),
        }),
      },
    });
    const init = {
      headers: {
        accept: "application/json",
        "x-demiurge-navigation": "data",
      },
    };
    const missing = await missingHandler(
      new Request("https://example.test/missing", init),
    );
    const broken = await brokenHandler(
      new Request("https://example.test/", init),
    );

    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-demiurge-navigation")).toBe("not-found");
    expect(broken.status).toBe(500);
    expect(broken.headers.get("x-demiurge-navigation")).toBe("error");
    await expect(missing.json()).resolves.toMatchObject({
      document: { links: [], scripts: [], title: "Demiurge App" },
      hasData: true,
    });
    await expect(broken.json()).resolves.toMatchObject({
      document: { links: [], scripts: [], title: "Demiurge App" },
      error: { title: "Internal Server Error" },
      hasData: true,
    });
  });

  it("escapes serialized route data for the hydration payload", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/index.tsx": routeModule({
          GET: page<string, { headline: string }>({
            data: async () => ({ headline: "</script><script>alert(1)</script>" }),
            view: DataView,
          }),
        }),
      },
    });

    const html = await (await handler(new Request("https://example.test/"))).text();

    expect(html).toContain('id="__demiurge_data"');
    expect(html).toContain('\\u003c/script\\u003e');
    expect(html).not.toContain("</script><script>alert(1)");
  });

  it("shares store-backed scopes across handlers but isolates request and none", async () => {
    const store = createMemoryCacheStore();
    const namespace = {
      app: "request-handler-test",
      environment: "test",
      schemaVersion: 1,
    } as const;
    const loads = new Map<CacheScope, number>();
    const routes = {
      "./routes/index.tsx": routeModule({
        GET: page<string, { scope: CacheScope; value: string }>({
          async data({ cache, search }) {
            const scope = search.get("scope") as CacheScope;

            return await cache.get({
              fn: () => {
                const sequence = (loads.get(scope) ?? 0) + 1;
                loads.set(scope, sequence);
                return { scope, value: `${scope}-${sequence}` };
              },
              key: ["scope", scope],
              scope,
            });
          },
          view: CacheScopeView,
        }),
      }),
    };
    const firstHandler = createRequestHandler({
      cacheStore: { namespace, store },
      routes,
    });
    const secondHandler = createRequestHandler({
      cacheStore: { namespace, store },
      routes,
    });

    for (const scope of ["build", "public", "private", "request", "none"] as const) {
      const first = await (
        await firstHandler(new Request(`https://example.test/?scope=${scope}`))
      ).text();
      const second = await (
        await secondHandler(new Request(`https://example.test/?scope=${scope}`))
      ).text();
      const expectedSecond = scope === "request" || scope === "none" ? 2 : 1;

      expect(first).toContain(`${scope}-1`);
      expect(second).toContain(`${scope}-${expectedSecond}`);
      expect(loads.get(scope)).toBe(expectedSecond);
    }
  });

  it("keeps public data request-local when no shared store is configured", async () => {
    const load = vi.fn(async () => `load-${load.mock.calls.length}`);
    const handler = createRequestHandler({
      routes: {
        "./routes/index.tsx": routeModule({
          GET: page<string, { headline: string }>({
            data: async ({ cache }) => ({
              headline: await cache.get({
                fn: load,
                key: ["home"],
                scope: "public",
              }),
            }),
            view: DataView,
          }),
        }),
      },
    });

    const first = await (await handler(new Request("https://example.test/"))).text();
    const second = await (await handler(new Request("https://example.test/"))).text();

    expect(first).toContain("load-1");
    expect(second).toContain("load-2");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("validates shared cache namespaces when the handler is created", () => {
    expect(() =>
      createRequestHandler({
        cacheStore: {
          namespace: {
            app: "bad:app",
            environment: "test",
            schemaVersion: 1,
          },
          store: createMemoryCacheStore(),
        },
        routes: {},
      })
    ).toThrow(/cache namespace app/);
  });

  it("reports shared store failures through the page error path", async () => {
    const onError = vi.fn();
    const store = createMemoryCacheStore();
    store.get = () => {
      throw new Error("cache unavailable");
    };
    const handler = createRequestHandler({
      cacheStore: {
        namespace: { app: "catalog", environment: "test", schemaVersion: 1 },
        store,
      },
      onError,
      routes: {
        "./routes/index.tsx": routeModule({
          GET: page({
            data: ({ cache }) => cache.get({
              fn: () => "unreachable",
              key: ["home"],
              scope: "public",
            }),
            view: () => null,
          }),
        }),
      },
    });

    const response = await handler(new Request("https://example.test/"));

    expect(response.status).toBe(500);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "cache unavailable" }),
      { pathname: "/", site: "page" },
    );
  });

  it("renders inherited layouts, metadata, resource hints, and scripts into the document", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/@layout.tsx": routeModule({
          default: Layout,
          links: defineLinks([preconnect("https://api.example.com")]),
          metadata: defineMetadata({ description: "Layout & document" }),
          scripts: defineScripts([
            script({ src: "https://cdn.example.com/root.js", strategy: "beforeInteractive" }),
          ]),
        }),
        "./routes/index.tsx": routeModule({
          GET: page(View),
          links: defineLinks([preload("/hero.avif", { as: "image", type: "image/avif" })]),
          metadata: defineMetadata({ title: "Home" }),
        }),
      },
      ssr: { clientEntry: "/client-entry.js", lang: "en-GB" },
    });

    const html = await (await handler(new Request("https://example.test/"))).text();

    expect(html).toContain(`<html lang="en-GB">`);
    expect(html).toContain("<title>Home</title>");
    expect(html).toContain(`<meta data-demiurge-document-contribution name="description" content="Layout &amp; document" />`);
    expect(html).toContain(`<link data-demiurge-document-contribution rel="preconnect" href="https://api.example.com" />`);
    expect(html).toContain(
      `<link data-demiurge-document-contribution rel="preload" href="/hero.avif" as="image" type="image/avif" />`,
    );
    expect(html).toContain(`<script data-demiurge-document-contribution data-demiurge-script-strategy="beforeInteractive" src="https://cdn.example.com/root.js"></script>`);
    expect(html).toContain(`<script type="module" src="/client-entry.js"></script>`);
    expect(html).toContain("<section>Layout: <main>Hello SSR</main></section>");
  });

  it("dedupes a managed script against a static declaration and propagates its nonce", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/@policy.ts": routeModule({
          policy: defineRoutePolicy({
            document: security.strict(),
            security: {
              needs: { script: ["https://cdn.example.com"] },
            },
          }),
        }),
        "./routes/index.tsx": routeModule({
          GET: page(() => (
            <main>
              <Script
                src="https://cdn.example.com/app.js"
                strategy="afterInteractive"
              />
            </main>
          )),
          scripts: defineScripts([
            script({
              id: "declared",
              src: "https://cdn.example.com/app.js",
              strategy: "beforeInteractive",
            }),
          ]),
        }),
      },
    });

    const response = await handler(new Request("https://example.test/"));
    const html = await response.text();
    const csp = response.headers.get("content-security-policy");

    expect(html.match(/https:\/\/cdn\.example\.com\/app\.js/g)).toHaveLength(1);
    expect(html).toContain('id="declared"');
    expect(html).toContain('nonce="');
    expect(csp).toContain("https://cdn.example.com");
  });

  it("propagates the nonce to an early managed script", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/@policy.ts": routeModule({
          policy: defineRoutePolicy({ document: security.strict() }),
        }),
        "./routes/index.tsx": routeModule({
          GET: page(() => <Script src="https://cdn.example.com/app.js" />),
        }),
      },
    });
    const response = await handler(new Request("https://example.test/"));
    const html = await response.text();

    expect(html).toMatch(/src="https:\/\/cdn\.example\.com\/app\.js" nonce="/);
  });

  it("renders a document string directly with renderPageDocument", () => {
    const html = renderPageDocument(
      {
        layouts: [],
        links: [],
        metadata: resolveMetadata(defineMetadata({ title: "Direct" })),
        page: View as ComponentType<RouteProps<string, unknown>>,
        path: {},
        pathname: "/",
        render: { mode: "ssr" },
        scripts: [],
      },
      { clientEntry: "/assets/client.js" },
    );

    expect(typeof html).toBe("string");
    expect(html).toContain("<main>Hello SSR</main>");
    expect(html).toContain("<title>Direct</title>");
    expect(html).toContain('src="/assets/client.js"');
  });

  it("marks the server-rendered root so the client hydrates instead of remounting", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/index.tsx": routeModule({ GET: page(View) }),
      },
    });

    const html = await (await handler(new Request("https://example.test/"))).text();

    expect(html).toContain('<div id="root" data-demiurge-hydrate="">');
    expect(html).toContain("Hello SSR");
  });
});

describe("Fetch Metadata route policy", () => {
  function guardedHandler(handlerSpy: () => string) {
    return createRequestHandler({
      routes: {
        "./routes/api/reports.tsx": routeModule({
          GET: text(handlerSpy, {
            security: { fetchMetadata: true },
          }),
          POST: text(handlerSpy, {
            cors: { origins: ["https://partner.example"] },
            security: { fetchMetadata: true },
          }),
        }),
        "./routes/api/public.tsx": routeModule({
          GET: text(handlerSpy, {
            security: { fetchMetadata: { allowCrossSite: true } },
          }),
        }),
        "./routes/api/open.tsx": routeModule({
          GET: text(handlerSpy),
        }),
        // A page declares route security through `policy`, because a page
        // capability carries no `security` option.
        "./routes/reports.tsx": routeModule({
          GET: page(View),
          policy: defineRoutePolicy({
            security: { fetchMetadata: true },
          }),
        }),
      },
    });
  }

  it("rejects a cross-site request before the route body runs", async () => {
    const handlerSpy = vi.fn(() => "report");
    const response = await guardedHandler(handlerSpy)(
      new Request("https://example.test/api/reports", {
        headers: {
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "no-cors",
          "sec-fetch-site": "cross-site",
        },
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("vary")).toBe("Sec-Fetch-Site, Sec-Fetch-Mode");
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("adds the consulted fields to Vary on an allowed response", async () => {
    const handlerSpy = vi.fn(() => "report");
    const response = await guardedHandler(handlerSpy)(
      new Request("https://example.test/api/reports", {
        headers: {
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("vary")).toBe("Sec-Fetch-Site");
    expect(handlerSpy).toHaveBeenCalledOnce();
  });

  it("adds the consulted fields to Vary on an allowed page document", async () => {
    const handlerSpy = vi.fn(() => "report");
    const response = await guardedHandler(handlerSpy)(
      new Request("https://example.test/reports", {
        headers: {
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "cross-site",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("vary")).toBe(
      "Sec-Fetch-Site, Sec-Fetch-Mode, Sec-Fetch-Dest",
    );
  });

  it("leaves a route without the policy unguarded", async () => {
    const handlerSpy = vi.fn(() => "open");
    const response = await guardedHandler(handlerSpy)(
      new Request("https://example.test/api/open", {
        headers: {
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "no-cors",
          "sec-fetch-site": "cross-site",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("vary")).toBeNull();
  });

  it("serves an exempt route to another site", async () => {
    const handlerSpy = vi.fn(() => "public");
    const response = await guardedHandler(handlerSpy)(
      new Request("https://example.test/api/public", {
        headers: {
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "cross-site",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("vary")).toBe("Sec-Fetch-Site");
  });

  it("answers a CORS preflight for a guarded route", async () => {
    const handlerSpy = vi.fn(() => "report");
    const response = await guardedHandler(handlerSpy)(
      new Request("https://example.test/api/reports", {
        headers: {
          "access-control-request-method": "POST",
          origin: "https://partner.example",
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "cross-site",
        },
        method: "OPTIONS",
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://partner.example",
    );
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("keeps the CORS Vary field beside the Fetch Metadata fields", async () => {
    const handlerSpy = vi.fn(() => "report");
    const response = await guardedHandler(handlerSpy)(
      new Request("https://example.test/api/reports", {
        headers: {
          origin: "https://partner.example",
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "cross-site",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("vary")).toBe("Sec-Fetch-Site, Origin");
  });

  it("lets a route policy declare the guard for a whole route group", async () => {
    const handlerSpy = vi.fn(() => "report");
    const handler = createRequestHandler({
      routes: {
        "./routes/api/@policy.ts": routeModule({
          policy: defineRoutePolicy({
            security: { fetchMetadata: { allowSameSite: true } },
          }),
        }),
        "./routes/api/reports.tsx": routeModule({
          GET: text(handlerSpy),
        }),
      },
    });
    const response = await handler(
      new Request("https://example.test/api/reports", {
        headers: {
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-site",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("vary")).toBe("Sec-Fetch-Site");
  });
});

async function hmacSignature(body: string, secret: string) {
  return hmacSignatureBytes(new TextEncoder().encode(body), secret, "hex");
}

async function hmacSignatureBytes(
  body: Uint8Array,
  secret: string,
  encoding: "base64" | "hex",
) {
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
    Uint8Array.from(body).buffer,
  );

  if (encoding === "base64") {
    return Buffer.from(signature).toString("base64");
  }

  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
