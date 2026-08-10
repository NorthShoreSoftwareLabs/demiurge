// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFileRouter,
  httpError,
  Link,
  page,
  type LayoutProps,
  type RouteErrorProps,
  type RouteProps,
} from "demiurge";

describe("browser router fallbacks", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("does not render framework-owned loading markup by default", () => {
    const Router = createFileRouter({ routes: {} });
    const result = render(<Router />);

    expect(result.container.textContent).toBe("");
  });

  it("renders app-provided loading UI", () => {
    const Router = createFileRouter({
      loading: Loading,
      routes: {},
    });

    render(<Router />);

    expect(screen.getByText("App loading")).toBeTruthy();
  });

  it("renders app-provided not-found UI", async () => {
    window.history.replaceState(null, "", "/missing");

    const Router = createFileRouter({
      notFound: NotFound,
      routes: {},
    });

    render(<Router />);

    await waitFor(() => {
      expect(screen.getByText("App not found: /missing")).toBeTruthy();
    });
  });

  it("renders inherited @loading UI while matched routes load", async () => {
    const routeResolver = deferred<Record<string, unknown>>();
    const Router = createFileRouter({
      loading: Loading,
      routes: {
        "./routes/@loading.tsx": routeModule({ default: RouteLoading }),
        "./routes/blog/index.tsx": vi.fn(() => routeResolver.promise),
      },
    });

    window.history.replaceState(null, "", "/blog");
    render(<Router />);

    await waitFor(() => {
      expect(screen.getByText("Route loading")).toBeTruthy();
    });

    routeResolver.resolve({ GET: page(BlogPage) });

    await waitFor(() => {
      expect(screen.getByText("Blog page at /blog")).toBeTruthy();
    });
  });

  it("renders inherited @not-found UI for missing routes", async () => {
    window.history.replaceState(null, "", "/blog/missing");

    const Router = createFileRouter({
      notFound: NotFound,
      routes: {
        "./routes/@not-found.tsx": routeModule({ default: NotFound }),
        "./routes/blog/@not-found.tsx": routeModule({ default: BlogNotFound }),
      },
    });

    render(<Router />);

    await waitFor(() => {
      expect(screen.getByText("Blog not found: /blog/missing")).toBeTruthy();
    });
  });

  it("renders inherited @error UI when a matched route throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    window.history.replaceState(null, "", "/blog");

    const Router = createFileRouter({
      routes: {
        "./routes/@error.tsx": routeModule({ default: RouteError }),
        "./routes/blog/index.tsx": routeModule({ GET: page(BrokenPage) }),
      },
    });

    render(<Router />);

    await waitFor(() => {
      expect(screen.getByText("Route error at /blog: render failed")).toBeTruthy();
    });
  });

  it("renders inherited @error UI when route loading fails", async () => {
    window.history.replaceState(null, "", "/blog");

    const Router = createFileRouter({
      routes: {
        "./routes/@error.tsx": routeModule({ default: RouteError }),
        "./routes/blog/index.tsx": vi.fn(async () => {
          throw new Error("load failed");
        }),
      },
    });

    render(<Router />);

    await waitFor(() => {
      expect(screen.getByText("Route error at /blog: load failed")).toBeTruthy();
    });
  });

  it("passes a typed status to the client error boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    window.history.replaceState(null, "", "/private");

    const Router = createFileRouter({
      routes: {
        "./routes/@error.tsx": routeModule({ default: StatusError }),
        "./routes/private.tsx": routeModule({ GET: page(ForbiddenPage) }),
      },
    });

    render(<Router />);

    await waitFor(() => {
      expect(screen.getByText("Route status: 403")).toBeTruthy();
    });
  });

  it("renders matched pages inside inherited layouts", async () => {
    const Router = createFileRouter({
      routes: {
        "./routes/@layout.tsx": routeModule({ default: RootLayout }),
        "./routes/blog/index.tsx": routeModule({ GET: page(BlogPage) }),
      },
    });

    window.history.replaceState(null, "", "/blog");
    render(<Router />);

    await waitFor(() => {
      expect(screen.getByText("Root layout")).toBeTruthy();
      expect(screen.getByText("Blog page at /blog")).toBeTruthy();
    });
  });

  it("navigates internal links without a document reload", async () => {
    const Router = createFileRouter({
      routes: {
        "./routes/index.tsx": routeModule({ GET: page(HomePage) }),
        "./routes/blog/index.tsx": routeModule({ GET: page(BlogPage) }),
      },
    });

    render(<Router />);

    await waitFor(() => {
      expect(screen.getByText("Home")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Blog"));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/blog");
      expect(screen.getByText("Blog page at /blog")).toBeTruthy();
    });
  });

  it("leaves non-primary link clicks to the browser", async () => {
    const Router = createFileRouter({
      routes: {
        "./routes/index.tsx": routeModule({ GET: page(SelfLinkPage) }),
        "./routes/blog/index.tsx": routeModule({ GET: page(BlogPage) }),
      },
    });

    render(<Router />);

    await waitFor(() => {
      expect(screen.getByText("Self")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Self"), { button: 1 });

    expect(window.location.pathname).toBe("/");
  });
});

function routeModule(module: Record<string, unknown>) {
  return async () => module;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

function Loading() {
  return <p>App loading</p>;
}

function RouteLoading() {
  return <p>Route loading</p>;
}

function NotFound({ pathname }: { pathname: string }) {
  return <p>App not found: {pathname}</p>;
}

function BlogNotFound({ pathname }: { pathname: string }) {
  return <p>Blog not found: {pathname}</p>;
}

function RouteError({ error, pathname }: { error: unknown; pathname: string }) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    <p>
      Route error at {pathname}: {message}
    </p>
  );
}

function StatusError({ status }: RouteErrorProps) {
  return <p>Route status: {status}</p>;
}

function RootLayout({ children }: LayoutProps) {
  return (
    <section>
      <h1>Root layout</h1>
      {children}
    </section>
  );
}

function HomePage(_props: RouteProps) {
  return (
    <>
      <h1>Home</h1>
      <Link to="/blog">Blog</Link>
    </>
  );
}

function BlogPage({ pathname }: RouteProps) {
  return <p>Blog page at {pathname}</p>;
}

function BrokenPage(_props: RouteProps): never {
  throw new Error("render failed");
}

function ForbiddenPage(_props: RouteProps): never {
  throw httpError(403, "Private page");
}

function SelfLinkPage(_props: RouteProps) {
  return <Link to="/">Self</Link>;
}
