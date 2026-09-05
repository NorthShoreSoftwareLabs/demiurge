// @vitest-environment jsdom

import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRequestHandler,
  hydrateFileRouter,
  Link,
  page,
  type RouteModule,
  type RouteProps,
} from "@demiurgejs/core";
import { resolveReactDomClient } from "../../src/browser/file-router";

describe("React DOM client interop", () => {
  it("accepts named and default-only Vite module shapes", () => {
    const client = {
      createRoot: vi.fn(),
      hydrateRoot: vi.fn(),
    };

    expect(resolveReactDomClient(client)).toBe(client);
    expect(resolveReactDomClient({ default: client })).toBe(client);
  });
});

describe("client hydration", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/blog");
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hydrates framework-rendered markup in place", async () => {
    const routes = { "./routes/blog/index.tsx": routeModule({ GET: page(BlogPage) }) };
    await installServerDocument(routes, "/blog");

    const root = documentRoot();
    const serverParagraph = root.querySelector("p");
    const consoleError = spyOnConsoleError();
    const collectErrors = captureRecoverableErrors();

    expect(root.hasAttribute("data-demiurge-hydrate")).toBe(true);
    expect(serverParagraph?.textContent).toBe("Blog page at /blog");

    await act(async () => {
      await hydrateFileRouter({
        loadNavigationData: async () => ({ hasData: true }),
        routes,
      });
    });

    expect(root.querySelector("p")).toBe(serverParagraph);
    expect(await collectErrors()).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("client renders a static shell instead of hydrating it", async () => {
    const routes = { "./routes/blog/index.tsx": routeModule({ GET: page(BlogPage) }) };
    document.body.innerHTML = `<div id="root"></div>`;

    const consoleError = spyOnConsoleError();
    const collectErrors = captureRecoverableErrors();

    await act(async () => {
      await hydrateFileRouter({
        loadNavigationData: async () => ({ hasData: true }),
        routes,
      });
    });

    expect(documentRoot().textContent).toBe("Blog page at /blog");
    expect(await collectErrors()).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("reuses serialized route data instead of loading it again", async () => {
    const data = vi.fn(async () => ({ headline: "Server headline" }));
    const routes = {
      "./routes/blog/index.tsx": routeModule({
        GET: page<string, { headline: string }>({ data, view: HeadlineView }),
      }),
    };

    await installServerDocument(routes, "/blog");
    expect(data).toHaveBeenCalledTimes(1);

    const consoleError = spyOnConsoleError();
    const collectErrors = captureRecoverableErrors();

    await act(async () => {
      await hydrateFileRouter({ routes });
    });

    expect(data).toHaveBeenCalledTimes(1);
    expect(documentRoot().textContent).toBe("Server headline");
    expect(await collectErrors()).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("loads route data from the server when the document carries no payload", async () => {
    const data = vi.fn(async () => ({ headline: "Client headline" }));
    const routes = {
      "./routes/blog/index.tsx": routeModule({
        GET: page<string, { headline: string }>({ data, view: HeadlineView }),
      }),
    };

    document.body.innerHTML = `<div id="root"></div>`;

    await act(async () => {
      await hydrateFileRouter({
        loadNavigationData: async () => ({
          data: { headline: "Server navigation headline" },
          hasData: true,
        }),
        routes,
      });
    });

    expect(data).not.toHaveBeenCalled();
    expect(documentRoot().textContent).toBe("Server navigation headline");
  });

  it("prefers explicitly provided initial data over the document payload", async () => {
    const data = vi.fn(async () => ({ headline: "Loaded headline" }));
    const routes = {
      "./routes/blog/index.tsx": routeModule({
        GET: page<string, { headline: string }>({ data, view: HeadlineView }),
      }),
    };

    document.body.innerHTML = `<div id="root"></div>`;

    await act(async () => {
      await hydrateFileRouter({
        initialData: { data: { headline: "Explicit headline" }, hasData: true },
        routes,
      });
    });

    expect(data).not.toHaveBeenCalled();
    expect(documentRoot().textContent).toBe("Explicit headline");
  });

  it("leaves links in static documents to native document navigation", async () => {
    const loadNavigationData = vi.fn(async () => ({ hasData: true }));
    const routes = {
      "./routes/blog/index.tsx": routeModule({
        GET: page({
          render: { mode: "static" },
          view: StaticPage,
        }),
      }),
    };
    await installServerDocument(routes, "/blog");

    await act(async () => {
      await hydrateFileRouter({ loadNavigationData, routes });
    });

    const link = documentRoot().querySelector("a");
    if (!link) throw new Error("Expected the static route link.");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });

    expect(link.dispatchEvent(event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(loadNavigationData).not.toHaveBeenCalled();
  });

  it("replaces server markup when the client cannot match the route", async () => {
    document.body.innerHTML =
      `<div id="root" data-demiurge-hydrate=""><p>Stale server markup</p></div>`;

    await act(async () => {
      await hydrateFileRouter({
        loadNavigationData: async () => ({ hasData: true }),
        notFound: NotFound,
        routes: {},
      });
    });

    expect(documentRoot().textContent).toBe("App not found: /blog");
  });

  it("mounts into an explicitly provided root element", async () => {
    const routes = { "./routes/blog/index.tsx": routeModule({ GET: page(BlogPage) }) };
    document.body.innerHTML = `<div id="app"></div>`;

    const root = document.getElementById("app");

    if (!root) {
      throw new Error("Expected the test root element.");
    }

    await act(async () => {
      await hydrateFileRouter({
        loadNavigationData: async () => ({ hasData: true }),
        root,
        routes,
      });
    });

    expect(root.textContent).toBe("Blog page at /blog");
  });

  it("fails clearly when the document has no root element", async () => {
    await expect(hydrateFileRouter({ routes: {} })).rejects.toThrow(
      /#root element/,
    );
  });

  it("fails clearly when the serialized route data is malformed", async () => {
    document.body.innerHTML =
      `<div id="root"></div><script type="application/json" id="__demiurge_data">{</script>`;

    await expect(hydrateFileRouter({ routes: {} })).rejects.toThrow(
      /initial route data/,
    );
  });
});

async function installServerDocument(
  routes: Record<string, () => Promise<RouteModule>>,
  pathname: string,
) {
  const handler = createRequestHandler({ routes });
  const response = await handler(new Request(`https://example.test${pathname}`));
  const html = await response.text();

  document.documentElement.innerHTML = html
    .replace(/^[\s\S]*?<html[^>]*>/, "")
    .replace(/<\/html>\s*$/, "");

  return html;
}

function documentRoot() {
  const root = document.getElementById("root");

  if (!root) {
    throw new Error("Expected a #root element in the test document.");
  }

  return root;
}

function spyOnConsoleError() {
  return vi.spyOn(console, "error").mockImplementation(() => undefined);
}

// React reports hydration mismatches as recoverable errors. It does not throw
// them. Monitoring the error channel verifies a clean mount.
function captureRecoverableErrors() {
  const errors: string[] = [];

  function onError(event: ErrorEvent) {
    errors.push(event.error instanceof Error ? event.error.message : event.message);
    event.preventDefault();
  }

  window.addEventListener("error", onError);

  return async function collect() {
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.removeEventListener("error", onError);

    return errors;
  };
}

// Each route needs an inherited access declaration, because the request
// pipeline denies a route that declares none. A test that does not examine
// authorization declares public access here.
function routeModule(module: RouteModule) {
  return vi.fn(async () => ({
    ...module,
    policy: { access: { public: true }, ...module.policy },
  }));
}

function BlogPage({ pathname }: RouteProps) {
  return <p>Blog page at {pathname}</p>;
}

function HeadlineView({ data }: RouteProps<string, { headline: string }>) {
  return <p>{data.headline}</p>;
}

function StaticPage() {
  return <Link hash="section" to="/blog">Static section</Link>;
}

function NotFound({ pathname }: { pathname: string }) {
  return <p>App not found: {pathname}</p>;
}
