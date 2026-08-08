import { describe, expect, it, vi } from "vitest";
import {
  createRequestHandler,
  defineRoutePolicy,
  json,
  jsonl,
  page,
  redirect,
  response as rawResponse,
  serverTiming,
  sse,
  stream,
  text,
  webhook,
  type RouteModule,
  type RouteProps,
} from "demiurge";

function View(_props: RouteProps) {
  return null;
}

function routeModule(module: RouteModule) {
  return vi.fn(async () => module);
}

describe("request handler", () => {
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

  it("rejects invalid Server-Timing metrics before sending responses", async () => {
    const invalidNameHandler = createRequestHandler({
      routes: {
        "./routes/api/health.tsx": routeModule({
          GET: json({ ok: true }, { timing: { name: "bad name" } }),
        }),
      },
    });
    const invalidDurationHandler = createRequestHandler({
      routes: {
        "./routes/api/health.tsx": routeModule({
          GET: json({ ok: true }, { timing: { duration: -1, name: "db" } }),
        }),
      },
    });

    await expect(
      invalidNameHandler(new Request("https://example.test/api/health")),
    ).rejects.toThrow(
      'Server-Timing metric name "bad name" is not a valid token.',
    );
    await expect(
      invalidDurationHandler(new Request("https://example.test/api/health")),
    ).rejects.toThrow(
      "Server-Timing metric duration must be a non-negative finite number.",
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
    const handler = createRequestHandler({
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

    await expect(
      handler(new Request("https://example.test/api/health")),
    ).rejects.toThrow("Demiurge route middleware next() called multiple times.");
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
            handler: ({ rawBody }) => Response.json({ rawBody }),
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
          "x-webhook-signature": `sha256=${signature}`,
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ rawBody: body });
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

  it("does not pretend page routes can render without a renderer", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/index.tsx": routeModule({
          GET: page(View),
        }),
      },
    });

    const response = await handler(new Request("https://example.test/"));

    expect(response.status).toBe(501);
    await expect(response.text()).resolves.toBe(
      "Page responses need an SSR or RSC renderer.",
    );
  });
});

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
