import { describe, expect, it, vi } from "vitest";
import {
  createRequestHandler,
  defineMetadata,
  defineRoutePolicy,
  json,
  notFound,
  page,
  security,
  text,
  type LayoutProps,
  type NotFoundProps,
  type RouteModule,
  type RouteProps,
} from "@demiurgejs/core";

function View(_props: RouteProps) {
  return <main>Home</main>;
}

function Layout({ children }: LayoutProps) {
  return <section data-layout="root">{children}</section>;
}

function AdminLayout({ children }: LayoutProps) {
  return <section data-layout="admin">{children}</section>;
}

function ThrowingLayout(_props: LayoutProps): never {
  throw new Error("Layout needs a session.");
}

function RootNotFound({ pathname }: NotFoundProps) {
  return <p data-not-found="root">Nothing at {pathname}</p>;
}

function routeModule(module: RouteModule) {
  return vi.fn(async () => module);
}

const htmlRequest = (path: string) =>
  new Request(`https://example.test${path}`, {
    headers: { accept: "text/html,application/xhtml+xml" },
  });

describe("not-found responses", () => {
  it("returns a document with inherited layouts for an unmatched navigation", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/@layout.tsx": routeModule({ default: Layout }),
        "./routes/@not-found.tsx": routeModule({ default: RootNotFound }),
        "./routes/admin/@layout.tsx": routeModule({ default: AdminLayout }),
        "./routes/index.tsx": routeModule({ GET: page({ view: View }) }),
      },
    });

    const response = await handler(htmlRequest("/admin/nope"));
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(body).toContain('data-layout="root"');
    expect(body).toContain('data-layout="admin"');
    expect(body).toContain('data-not-found="root"');
    expect(body).toContain("/admin/nope");
    // The body is the point. A bodiless shell is what this replaced.
    expect(body).not.toContain('<div id="root"></div>');
  });

  it("marks the document as a fallback so the client hydrates it", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/@not-found.tsx": routeModule({ default: RootNotFound }),
        "./routes/index.tsx": routeModule({ GET: page({ view: View }) }),
      },
    });

    const body = await (await handler(htmlRequest("/nope"))).text();

    expect(body).toContain('data-demiurge-fallback="not-found"');
  });

  it("applies path-inherited document policy and nonce headers to HTML fallbacks", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/@not-found.tsx": routeModule({ default: RootNotFound }),
        "./routes/@policy.ts": routeModule({
          policy: defineRoutePolicy({
            document: security.static({
              headers: { referrerPolicy: "same-origin" },
            }),
          }),
        }),
        "./routes/admin/@policy.ts": routeModule({
          policy: defineRoutePolicy({ document: security.strict() }),
        }),
        "./routes/index.tsx": routeModule({ GET: page({ view: View }) }),
      },
      ssr: { clientEntry: "/assets/app.js" },
    });

    const rootResponse = await handler(htmlRequest("/missing"));
    const nestedResponse = await handler(htmlRequest("/admin/missing"));
    const nestedHtml = await nestedResponse.text();

    expect(rootResponse.headers.get("referrer-policy")).toBe("same-origin");
    expect(rootResponse.headers.get("content-security-policy")).toContain(
      "script-src 'self'",
    );
    expect(nestedResponse.headers.get("content-security-policy")).toMatch(
      /'nonce-[A-Za-z0-9+/=]+'/,
    );
    expect(nestedHtml).toMatch(/nonce="[A-Za-z0-9+/=]+"/);
  });

  it("does not apply document policy to negotiated problem responses", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/@policy.ts": routeModule({
          policy: defineRoutePolicy({ document: security.static() }),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/missing", {
        headers: { accept: "application/json" },
      }),
    );

    expect(response.headers.has("content-security-policy")).toBe(false);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json; charset=utf-8",
    );
  });

  it("sends problem+json to anything that did not ask for HTML", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/@not-found.tsx": routeModule({ default: RootNotFound }),
        "./routes/api/health.tsx": routeModule({ GET: json({ ok: true }) }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/widgets/9?page=2", {
        headers: { accept: "application/json" },
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json; charset=utf-8",
    );
    await expect(response.json()).resolves.toEqual({
      instance: "/api/widgets/9?page=2",
      status: 404,
      title: "Not Found",
      type: "about:blank",
    });
  });

  it("sends problem+json when the request carries no accept header", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/@not-found.tsx": routeModule({ default: RootNotFound }),
      },
    });

    const response = await handler(new Request("https://example.test/nope"));

    expect(response.headers.get("content-type")).toBe(
      "application/problem+json; charset=utf-8",
    );
  });

  it("renders the built-in document when the app owns no @not-found", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/index.tsx": routeModule({ GET: page({ view: View }) }),
      },
    });

    const response = await handler(htmlRequest("/nope"));
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).toContain("404");
    expect(body).toContain("No route matched");
    expect(body).toContain("/nope");
  });

  // A layout resolved for an unmatched path is the likeliest thing to expect a
  // session, and `/admin/nope` is exactly where that happens.
  it("falls back to the layout-free document when a layout throws", async () => {
    const onError = vi.fn();
    const handler = createRequestHandler({
      onError,
      routes: {
        "./routes/@not-found.tsx": routeModule({ default: RootNotFound }),
        "./routes/admin/@layout.tsx": routeModule({ default: ThrowingLayout }),
        "./routes/index.tsx": routeModule({ GET: page({ view: View }) }),
      },
    });

    const response = await handler(htmlRequest("/admin/nope"));
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).toContain('data-not-found="root"');
    expect(body).not.toContain('data-layout="admin"');
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Layout needs a session." }),
      { pathname: "/admin/nope", site: "page" },
    );
  });

  it("falls back to the built-in when the app not-found itself throws", async () => {
    function BrokenNotFound(_props: NotFoundProps): never {
      throw new Error("Not-found is broken.");
    }

    const handler = createRequestHandler({
      onError: vi.fn(),
      routes: {
        "./routes/@not-found.tsx": routeModule({ default: BrokenNotFound }),
        "./routes/index.tsx": routeModule({ GET: page({ view: View }) }),
      },
    });

    const response = await handler(htmlRequest("/nope"));

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toContain("No route matched");
  });

  it("skips layouts when @not-found opts out", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/@layout.tsx": routeModule({ default: Layout }),
        "./routes/@not-found.tsx": routeModule({
          default: RootNotFound,
          layout: false,
        }),
        "./routes/index.tsx": routeModule({ GET: page({ view: View }) }),
      },
    });

    const body = await (await handler(htmlRequest("/nope"))).text();

    expect(body).toContain('data-not-found="root"');
    expect(body).not.toContain('data-layout="root"');
  });

  it("resolves the closest @not-found for the requested path", async () => {
    function BlogNotFound({ pathname }: NotFoundProps) {
      return <p data-not-found="blog">No post at {pathname}</p>;
    }

    const handler = createRequestHandler({
      routes: {
        "./routes/@not-found.tsx": routeModule({ default: RootNotFound }),
        "./routes/blog/@not-found.tsx": routeModule({ default: BlogNotFound }),
        "./routes/index.tsx": routeModule({ GET: page({ view: View }) }),
      },
    });

    await expect(
      (await handler(htmlRequest("/blog/missing"))).text(),
    ).resolves.toContain('data-not-found="blog"');
    await expect(
      (await handler(htmlRequest("/missing"))).text(),
    ).resolves.toContain('data-not-found="root"');
  });

  it("titles the document from layout and not-found metadata", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/@layout.tsx": routeModule({
          default: Layout,
          metadata: defineMetadata({
            title: { format: (title) => `${title} | Demiurge` },
          }),
        }),
        "./routes/@not-found.tsx": routeModule({
          default: RootNotFound,
          metadata: defineMetadata({ title: "Not Found" }),
        }),
        "./routes/index.tsx": routeModule({ GET: page({ view: View }) }),
      },
    });

    const body = await (await handler(htmlRequest("/nope"))).text();

    expect(body).toContain("<title>Not Found | Demiurge</title>");
  });

  // A route group has no URL segment, so a pathname can never resolve into it.
  it("ignores layouts inside route groups", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/(marketing)/@layout.tsx": routeModule({ default: Layout }),
        "./routes/@not-found.tsx": routeModule({ default: RootNotFound }),
        "./routes/index.tsx": routeModule({ GET: page({ view: View }) }),
      },
    });

    const body = await (await handler(htmlRequest("/nope"))).text();

    expect(body).toContain('data-not-found="root"');
    expect(body).not.toContain('data-layout="root"');
  });
});

describe("the notFound() response capability", () => {
  it("negotiates the same way an unmatched path does", async () => {
    const routes = {
      "./routes/@not-found.tsx": routeModule({ default: RootNotFound }),
      "./routes/gone.tsx": routeModule({ GET: notFound() }),
    };
    const handler = createRequestHandler({ routes });

    const document = await handler(htmlRequest("/gone"));
    const problem = await handler(
      new Request("https://example.test/gone", {
        headers: { accept: "application/json" },
      }),
    );

    expect(document.status).toBe(404);
    await expect(document.text()).resolves.toContain('data-not-found="root"');
    expect(problem.headers.get("content-type")).toBe(
      "application/problem+json; charset=utf-8",
    );
    await expect(problem.json()).resolves.toMatchObject({ status: 404 });
  });

  it("leaves an explicit body alone", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/@not-found.tsx": routeModule({ default: RootNotFound }),
        "./routes/gone.tsx": routeModule({ GET: notFound("all gone") }),
      },
    });

    const response = await handler(htmlRequest("/gone"));

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("all gone");
  });

  it("keeps multiple set-cookie headers from the capability", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/@not-found.tsx": routeModule({ default: RootNotFound }),
        "./routes/gone.tsx": routeModule({
          GET: notFound(undefined, {
            headers: [
              ["set-cookie", "a=1; Path=/"],
              ["set-cookie", "b=2; Path=/"],
            ],
          }),
        }),
      },
    });

    const response = await handler(htmlRequest("/gone"));

    // Iterating a `Headers` collapses set-cookie into one comma-joined value,
    // which is exactly how multiple cookies get silently dropped.
    expect(response.headers.getSetCookie()).toEqual([
      "a=1; Path=/",
      "b=2; Path=/",
    ]);
  });

  it("keeps an explicit status and headers from the capability", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/@not-found.tsx": routeModule({ default: RootNotFound }),
        "./routes/gone.tsx": routeModule({
          GET: notFound(undefined, {
            headers: { "x-reason": "retired" },
            status: 410,
          }),
        }),
      },
    });

    const response = await handler(htmlRequest("/gone"));

    expect(response.status).toBe(410);
    expect(response.headers.get("x-reason")).toBe("retired");
  });
});

describe("routes whose GET is not a page", () => {
  it("answers from the response capability and never reaches the 404 path", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/@not-found.tsx": routeModule({ default: RootNotFound }),
        "./routes/api/health.tsx": routeModule({ GET: text("ok") }),
      },
    });

    const response = await handler(htmlRequest("/api/health"));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ok");
  });
});
