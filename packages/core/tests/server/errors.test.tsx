import { describe, expect, it, vi } from "vitest";
import {
  createRequestHandler,
  httpError,
  json,
  page,
  text,
  type RouteErrorProps,
  type RouteModule,
  type RouteProps,
} from "@demiurgejs/core";
import {
  unstable_createRouteManifest,
  handleRequestWithManifest,
} from "@demiurgejs/core/internal/testing";

function BrokenView(_props: RouteProps): never {
  throw new Error("Loader blew up in /srv/app/routes/index.tsx");
}

function StringErrorView(_props: RouteProps): never {
  throw "plain failure";
}

function AppError({ error, pathname, status }: RouteErrorProps) {
  return (
    <p data-error="app">
      {status} {pathname} failed: {error instanceof Error ? error.name : "unknown"}
    </p>
  );
}

function BrokenError(_props: RouteErrorProps): never {
  throw new Error("The error page is broken too.");
}

function routeModule(module: RouteModule) {
  return vi.fn(async () => module);
}

function throwingModule(message: string) {
  return vi.fn(async (): Promise<RouteModule> => {
    throw new Error(message);
  });
}

const htmlRequest = (path: string) =>
  new Request(`https://example.test${path}`, {
    headers: { accept: "text/html" },
  });

const jsonRequest = (path: string) =>
  new Request(`https://example.test${path}`, {
    headers: { accept: "application/json" },
  });

describe("a failure inside a page render", () => {
  it("renders the app error document", async () => {
    const onError = vi.fn();
    const handler = createRequestHandler({
      onError,
      routes: {
        "./routes/@error.tsx": routeModule({ default: AppError }),
        "./routes/index.tsx": routeModule({ GET: page({ view: BrokenView }) }),
      },
    });

    const response = await handler(htmlRequest("/"));
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(body).toContain('data-error="app"');
    expect(onError).toHaveBeenCalledWith(expect.any(Error), {
      pathname: "/",
      site: "page",
    });
  });

  it("applies resolved language and direction to an error document", async () => {
    const handler = createRequestHandler({
      onError: vi.fn(),
      routes: {
        "./routes/@error.tsx": routeModule({ default: AppError }),
        "./routes/index.tsx": routeModule({ GET: page({ view: BrokenView }) }),
      },
      ssr: { dir: "rtl", lang: "ar" },
    });

    const body = await (await handler(htmlRequest("/"))).text();

    expect(body).toContain('<html lang="ar" dir="rtl">');
  });

  // A page render already committed to a document, so it stays a document even
  // for a caller that asked for JSON.
  it("stays a document whatever the caller asked for", async () => {
    const handler = createRequestHandler({
      onError: vi.fn(),
      routes: {
        "./routes/@error.tsx": routeModule({ default: AppError }),
        "./routes/index.tsx": routeModule({ GET: page({ view: BrokenView }) }),
      },
    });

    const response = await handler(jsonRequest("/"));

    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
  });

  it("uses the built-in document when the app owns no @error", async () => {
    const handler = createRequestHandler({
      onError: vi.fn(),
      routes: {
        "./routes/index.tsx": routeModule({ GET: page({ view: BrokenView }) }),
      },
    });

    const body = await (await handler(htmlRequest("/"))).text();

    expect(body).toContain("500");
    expect(body).toContain("Something went wrong");
  });
});

describe("a failure inside an API route handler", () => {
  it("never returns HTML, even when the caller asks for it", async () => {
    const onError = vi.fn();
    const handler = createRequestHandler({
      onError,
      routes: {
        "./routes/api/widgets.tsx": routeModule({
          GET: json(() => {
            throw new Error("database is down");
          }),
        }),
      },
    });

    const response = await handler(htmlRequest("/api/widgets"));

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json; charset=utf-8",
    );
    await expect(response.json()).resolves.toEqual({
      instance: "/api/widgets",
      status: 500,
      title: "Internal Server Error",
      type: "about:blank",
    });
    expect(onError).toHaveBeenCalledWith(expect.any(Error), {
      pathname: "/api/widgets",
      site: "route",
    });
  });

  it("maps a typed error to public problem details, extensions, and headers", async () => {
    const onError = vi.fn();
    const handler = createRequestHandler({
      onError,
      routes: {
        "./routes/api/widgets.tsx": routeModule({
          POST: json(() => {
            throw httpError(
              422,
              {
                detail: "slug already taken",
                errors: { slug: ["Choose another slug."] },
                title: "Widget validation failed",
                type: "https://example.test/problems/widget-validation",
              },
              { headers: { "retry-after": "5" } },
            );
          }),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/widgets?draft=1", {
        headers: { accept: "text/html" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json; charset=utf-8",
    );
    expect(response.headers.get("retry-after")).toBe("5");
    await expect(response.json()).resolves.toEqual({
      detail: "slug already taken",
      errors: { slug: ["Choose another slug."] },
      instance: "/api/widgets?draft=1",
      status: 422,
      title: "Widget validation failed",
      type: "https://example.test/problems/widget-validation",
    });
    expect(onError).toHaveBeenCalledWith(expect.any(Error), {
      pathname: "/api/widgets",
      site: "route",
    });
  });

  it("uses the standard title and preserves authentication challenges", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/private.tsx": routeModule({
          GET: json(() => {
            throw httpError(401, undefined, {
              headers: { "www-authenticate": 'Bearer realm="widgets"' },
            });
          }),
        }),
      },
    });

    const response = await handler(jsonRequest("/api/private"));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer realm="widgets"',
    );
    await expect(response.json()).resolves.toMatchObject({
      status: 401,
      title: "Unauthorized",
    });
  });
});

describe("a typed failure inside a page render", () => {
  it("renders the app error document with the explicit status and headers", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/@error.tsx": routeModule({ default: AppError }),
        "./routes/index.tsx": routeModule({
          GET: page({
            data: () => {
              throw httpError(410, "This page has been removed.", {
                headers: { "cache-control": "public, max-age=60" },
              });
            },
            view: () => null,
          }),
        }),
      },
    });

    const response = await handler(htmlRequest("/"));
    const body = await response.text();

    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(body).toContain('data-error="app">410');
    expect(body).toContain("HttpError</p>");
    expect(body).not.toContain("This page has been removed");
  });

  it("uses the typed status in the built-in production document", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/index.tsx": routeModule({
          GET: page({
            data: () => {
              throw httpError(403, "Not your widget");
            },
            view: () => null,
          }),
        }),
      },
    });

    const body = await (await handler(htmlRequest("/"))).text();

    expect(body).toContain("403");
    expect(body).not.toContain("Not your widget");
  });
});

describe("a failure inside middleware or policy", () => {
  it("negotiates like an unmatched path", async () => {
    const routes = {
      "./routes/@error.tsx": routeModule({ default: AppError }),
      "./routes/@middleware.ts": routeModule({
        middleware: () => {
          throw new Error("session store unreachable");
        },
      }),
      "./routes/api/widgets.tsx": routeModule({ GET: json({ ok: true }) }),
      "./routes/index.tsx": routeModule({ GET: page({ view: () => null }) }),
    };
    const onError = vi.fn();
    const handler = createRequestHandler({ onError, routes });

    const document = await handler(htmlRequest("/"));
    const problem = await handler(jsonRequest("/api/widgets"));

    expect(document.status).toBe(500);
    expect(document.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(problem.headers.get("content-type")).toBe(
      "application/problem+json; charset=utf-8",
    );
    expect(onError).toHaveBeenCalledWith(expect.any(Error), {
      pathname: "/",
      site: "middleware",
    });
  });

  it("catches a policy module that fails to load", async () => {
    const handler = createRequestHandler({
      onError: vi.fn(),
      routes: {
        "./routes/@policy.ts": throwingModule("policy import failed"),
        "./routes/index.tsx": routeModule({ GET: page({ view: () => null }) }),
      },
    });

    const response = await handler(htmlRequest("/"));

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
  });

  it("negotiates a typed middleware error without losing its status", async () => {
    const routes = {
      "./routes/@error.tsx": routeModule({ default: AppError }),
      "./routes/@middleware.ts": routeModule({
        middleware: () => {
          throw httpError(429, "Request budget exhausted.", {
            headers: { "retry-after": "60" },
          });
        },
      }),
      "./routes/api/widgets.tsx": routeModule({ GET: json({ ok: true }) }),
      "./routes/index.tsx": routeModule({ GET: page({ view: () => null }) }),
    };
    const handler = createRequestHandler({ routes });

    const document = await handler(htmlRequest("/"));
    const problem = await handler(jsonRequest("/api/widgets"));

    expect(document.status).toBe(429);
    expect(document.headers.get("retry-after")).toBe("60");
    expect(await document.text()).toContain('data-error="app">429');
    expect(problem.status).toBe(429);
    expect(problem.headers.get("retry-after")).toBe("60");
    await expect(problem.json()).resolves.toMatchObject({
      detail: "Request budget exhausted.",
      status: 429,
      title: "Too Many Requests",
    });
  });
});

// Once the error path has failed, the app path cannot be trusted a second time
// in the same request.
describe("a failure while rendering the error page", () => {
  it("falls back to plain text and runs no more app code", async () => {
    const onError = vi.fn();
    const handler = createRequestHandler({
      onError,
      routes: {
        "./routes/@error.tsx": routeModule({ default: BrokenError }),
        "./routes/index.tsx": routeModule({ GET: page({ view: BrokenView }) }),
      },
    });

    const response = await handler(htmlRequest("/"));

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    await expect(response.text()).resolves.toBe("Internal Server Error");
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "The error page is broken too." }),
      { pathname: "/", site: "page" },
    );
  });
});

describe("stack traces", () => {
  const routes = {
    "./routes/api/widgets.tsx": routeModule({
      GET: json(() => {
        throw new Error("database is down");
      }),
    }),
    "./routes/index.tsx": routeModule({ GET: page({ view: BrokenView }) }),
  };

  it("never reach a production body", async () => {
    const handler = createRequestHandler({ onError: vi.fn(), routes });

    const document = await (await handler(htmlRequest("/"))).text();
    const problem = await (await handler(jsonRequest("/api/widgets"))).text();

    for (const body of [document, problem]) {
      expect(body).not.toContain("Loader blew up");
      expect(body).not.toContain("database is down");
      expect(body).not.toContain("/srv/app/routes");
      expect(body).not.toContain(".tsx:");
      expect(body).not.toContain("    at ");
    }
  });

  it("reach a dev body, with the route that failed", async () => {
    const manifest = unstable_createRouteManifest(routes);
    const response = await handleRequestWithManifest(
      manifest,
      htmlRequest("/"),
      { dev: true, onError: vi.fn() },
    );
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain("Loader blew up");
    expect(body).toContain("/srv/app/routes/index.tsx");
    expect(body).toContain("<pre>");
  });

  it("renders non-Error failures without inventing a stack", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/index.tsx": routeModule({
        GET: page({ view: StringErrorView }),
      }),
    });
    const response = await handleRequestWithManifest(
      manifest,
      htmlRequest("/"),
      { dev: true, onError: vi.fn() },
    );
    const body = await response.text();

    expect(body).toContain("plain failure");
    expect(body).not.toContain("<pre>");
  });

  it("reach a dev problem+json as detail", async () => {
    const manifest = unstable_createRouteManifest(routes);
    const response = await handleRequestWithManifest(
      manifest,
      jsonRequest("/api/widgets"),
      { dev: true, onError: vi.fn() },
    );

    await expect(response.json()).resolves.toMatchObject({
      detail: "database is down",
      status: 500,
    });
  });

  // The switch is the build mode, so there is no public option to set. A
  // caller that reaches the internal flag anyway still cannot turn it on in a
  // production process.
  it("stay off in a production process even with the dev flag set", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      const manifest = unstable_createRouteManifest(routes);
      const body = await (
        await handleRequestWithManifest(manifest, htmlRequest("/"), {
          dev: true,
          onError: vi.fn(),
        })
      ).text();

      expect(body).not.toContain("Loader blew up");
      expect(body).toContain("Something went wrong");
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

describe("error reporting", () => {
  it("defaults to no reporter without swallowing the response", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/api/widgets.tsx": routeModule({
          GET: text(() => {
            throw new Error("nope");
          }),
        }),
      },
    });

    const response = await handler(jsonRequest("/api/widgets"));

    expect(response.status).toBe(500);
  });
});
