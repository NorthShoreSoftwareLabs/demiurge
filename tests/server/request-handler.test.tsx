import { describe, expect, it, vi } from "vitest";
import {
  createRequestHandler,
  json,
  page,
  redirect,
  text,
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
