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
