// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFileRouter,
  Form,
  defineLinks,
  defineScripts,
  httpError,
  Link,
  page,
  RouteFocusBoundary,
  useFormNavigation,
  useRouteFocusBoundary,
  useNavigation,
  resolveMetadata,
  type LayoutProps,
  type LinkProps,
  type RouteErrorProps,
  type RouteProps,
} from "@demiurgejs/core";

describe("browser router fallbacks", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    document.body.querySelector("[data-demiurge-navigation-status]")?.remove();
    vi.stubGlobal("fetch", vi.fn(async () =>
      Response.json(
        { hasData: true },
        { headers: { "x-demiurge-navigation": "data" } },
      )));
  });

  it("submits an explicit Form with a versioned action request", async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init) calls.push(init);
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ version: 1, status: "success" }), {
          headers: { "content-type": "application/vnd.demiurge.action+json;v=1" },
        });
      }
      return Response.json(
        { hasData: true },
        { headers: { "x-demiurge-navigation": "data" } },
      );
    }));
    const Router = createFileRouter({
      routes: { "./routes/index.tsx": routeModule({ GET: page(ActionFormPage) }) },
    });
    render(<Router />);
    await waitFor(() => expect(screen.getByRole("button")).toBeTruthy());
    fireEvent.submit(screen.getByRole("form"));
    await waitFor(() => expect(calls.some((init) => init.method === "POST")).toBe(true));
    const action = calls.find((init) => init.method === "POST");
    expect(new Headers(action?.headers).get("x-demiurge-action")).toBe("data;v=1");
    expect(new Headers(action?.headers).get("content-type")).toContain("application/x-www-form-urlencoded");
    expect(String(action?.body)).toContain("title=Draft");
    await waitFor(() => expect(screen.getByText("idle")).toBeTruthy());
  });

  it("keeps external action forms native", async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") throw new Error("unexpected action request");
      return Response.json({ hasData: true }, { headers: { "x-demiurge-navigation": "data" } });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const Router = createFileRouter({
      routes: { "./routes/index.tsx": routeModule({ GET: page(ExternalFormPage) }) },
    });
    render(<Router />);
    await waitFor(() => expect(screen.getByRole("button")).toBeTruthy());
    fireEvent.submit(screen.getByRole("button"));
    expect(fetchSpy.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it.each([
    ["invalid", { version: 1, status: "invalid", data: { issues: [] } }, "invalid"],
    ["failed", { version: 1, status: "failed", message: "Save failed" }, "error"],
  ])("reports a %s action result", async (_name, result, expectedState) => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response(JSON.stringify(result), {
            headers: { "content-type": "application/vnd.demiurge.action+json;v=1" },
            status: result.status === "failed" ? 500 : 400,
          })
        : Response.json(
            { hasData: true },
            { headers: { "x-demiurge-navigation": "data" } },
          ),
    ));
    const Router = createFileRouter({
      routes: { "./routes/index.tsx": routeModule({ GET: page(ActionFormPage) }) },
    });
    render(<Router />);
    await waitFor(() => expect(screen.getByRole("form")).toBeTruthy());
    fireEvent.submit(screen.getByRole("form"));
    await waitFor(() => expect(screen.getByText(expectedState)).toBeTruthy());
  });

  it.each(["push", "replace"] as const)("follows a valid %s action redirect", async (history) => {
    const historySpy = vi.spyOn(window.history, history === "push" ? "pushState" : "replaceState");
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response(JSON.stringify({
            version: 1,
            status: "redirect",
            location: "/saved?from=action#result",
            history,
          }), { headers: { "content-type": "application/vnd.demiurge.action+json;v=1" } })
        : Response.json(
            { hasData: true },
            { headers: { "x-demiurge-navigation": "data" } },
          ),
    ));
    const Router = createFileRouter({
      routes: {
        "./routes/index.tsx": routeModule({ GET: page(ActionFormPage) }),
        "./routes/saved.tsx": routeModule({ GET: page(ActionFormPage) }),
      },
    });
    render(<Router />);
    await waitFor(() => expect(screen.getByRole("form")).toBeTruthy());
    fireEvent.submit(screen.getByRole("form"));
    await waitFor(() => expect(window.location.pathname).toBe("/saved"));
    expect(historySpy).toHaveBeenCalledWith(null, "", "/saved?from=action#result");
    await waitFor(() => expect(screen.getByText("idle")).toBeTruthy());
  });

  it("rejects an external action redirect", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response(JSON.stringify({
            version: 1,
            status: "redirect",
            location: "https://other.example/saved",
            history: "push",
          }), { headers: { "content-type": "application/vnd.demiurge.action+json;v=1" } })
        : Response.json(
            { hasData: true },
            { headers: { "x-demiurge-navigation": "data" } },
          ),
    ));
    const Router = createFileRouter({
      routes: { "./routes/index.tsx": routeModule({ GET: page(ActionFormPage) }) },
    });
    render(<Router />);
    await waitFor(() => expect(screen.getByRole("form")).toBeTruthy());
    fireEvent.submit(screen.getByRole("form"));
    await waitFor(() => expect(screen.getByText("error")).toBeTruthy());
    expect(window.location.pathname).toBe("/");
  });

  it("revalidates the route after a successful action", async () => {
    let navigationLoads = 0;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({
          version: 1,
          status: "success",
          revalidate: true,
        }), { headers: { "content-type": "application/vnd.demiurge.action+json;v=1" } });
      }
      navigationLoads += 1;
      return Response.json(
        { hasData: true },
        { headers: { "x-demiurge-navigation": "data" } },
      );
    }));
    const Router = createFileRouter({
      routes: { "./routes/index.tsx": routeModule({ GET: page(ActionFormPage) }) },
    });
    render(<Router />);
    await waitFor(() => expect(screen.getByRole("form")).toBeTruthy());
    const before = navigationLoads;
    fireEvent.submit(screen.getByRole("form"));
    await waitFor(() => expect(navigationLoads).toBeGreaterThan(before));
    await waitFor(() => expect(screen.getByText("idle")).toBeTruthy());
  });

  it("reports a failed action request", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") throw new Error("network unavailable");
      return Response.json(
        { hasData: true },
        { headers: { "x-demiurge-navigation": "data" } },
      );
    }));
    const Router = createFileRouter({
      routes: { "./routes/index.tsx": routeModule({ GET: page(ActionFormPage) }) },
    });
    render(<Router />);
    await waitFor(() => expect(screen.getByRole("form")).toBeTruthy());
    fireEvent.submit(screen.getByRole("form"));
    await waitFor(() => expect(screen.getByText("error")).toBeTruthy());
  });

  it.each([
    ["an unmarked response", { status: "success", version: 1 }, "application/json", "idle"],
    ["a malformed response", { status: "success", version: 1, revalidate: "yes" }, "application/vnd.demiurge.action+json;v=1", "error"],
    ["a non-revalidating success", { status: "success", version: 1, revalidate: false }, "application/vnd.demiurge.action+json;v=1", "idle"],
  ])("handles %s", async (_name, result, contentType, expectedState) => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response(JSON.stringify(result), { headers: { "content-type": contentType } })
        : Response.json(
            { hasData: true },
            { headers: { "x-demiurge-navigation": "data" } },
          ),
    ));
    const Router = createFileRouter({
      routes: { "./routes/index.tsx": routeModule({ GET: page(ActionFormPage) }) },
    });
    render(<Router />);
    await waitFor(() => expect(screen.getByRole("form")).toBeTruthy());
    fireEvent.submit(screen.getByRole("form"));
    await waitFor(() => expect(screen.getByText(expectedState)).toBeTruthy());
  });

  it("serializes multipart and plain-text action forms", async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        calls.push(init);
        return new Response(JSON.stringify({ version: 1, status: "success" }), {
          headers: { "content-type": "application/vnd.demiurge.action+json;v=1" },
        });
      }
      return Response.json(
        { hasData: true },
        { headers: { "x-demiurge-navigation": "data" } },
      );
    }));
    const Router = createFileRouter({
      routes: { "./routes/index.tsx": routeModule({ GET: page(EncodingFormsPage) }) },
    });
    render(<Router />);
    await waitFor(() => expect(screen.getAllByRole("form")).toHaveLength(2));
    fireEvent.submit(screen.getByRole("form", { name: "multipart action" }));
    fireEvent.submit(screen.getByRole("form", { name: "text action" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]?.body).toBeInstanceOf(FormData);
    expect(new Headers(calls[0]?.headers).has("content-type")).toBe(false);
    expect(calls[1]?.body).toBe("title=Draft\r\n");
    expect(new Headers(calls[1]?.headers).get("content-type")).toBe("text/plain;charset=UTF-8");
  });

  it("reads context state and retains success data after route revalidation", async () => {
    const refresh = deferred<{ hasData: true }>();
    let loads = 0;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({
          data: { saved: "refreshed" },
          revalidate: true,
          status: "success",
          version: 1,
        }), { headers: { "content-type": "application/vnd.demiurge.action+json;v=1" } });
      }
      return Response.json({ hasData: true }, { headers: { "x-demiurge-navigation": "data" } });
    }));
    const Router = createFileRouter({
      loadNavigationData: async () => ++loads === 1 ? { hasData: true } : await refresh.promise,
      routes: { "./routes/index.tsx": routeModule({ GET: page(RefreshActionFormPage) }) },
    });
    render(<Router />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeTruthy());
    fireEvent.submit(screen.getByRole("button", { name: "Save" }).closest("form")!);
    await waitFor(() => expect(screen.getByLabelText("context state").textContent).toBe("loading"));
    refresh.resolve({ hasData: true });
    await waitFor(() => expect(screen.getByLabelText("action result").textContent).toBe("refreshed"));
  });

  it("aborts and clears a keyed Form when the component unmounts", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        signal = init.signal ?? undefined;
        return await new Promise<Response>(() => undefined);
      }
      return Response.json({ hasData: true }, { headers: { "x-demiurge-navigation": "data" } });
    }));
    const Router = createFileRouter({
      routes: { "./routes/index.tsx": routeModule({ GET: page(UnmountActionFormPage) }) },
    });
    render(<Router />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeTruthy());
    fireEvent.submit(screen.getByRole("button", { name: "Save" }).closest("form")!);
    await waitFor(() => expect(screen.getByLabelText("unmount state").textContent).toBe("submitting"));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByLabelText("unmount state").textContent).toBe("idle"));
    expect(signal?.aborted).toBe(true);
  });

  it("preserves submitter action, method, plain-text encoding, and value", async () => {
    const calls: [RequestInfo | URL, RequestInit | undefined][] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      if (init?.method === "PATCH") return actionResponse({ status: "success", version: 1 });
      return Response.json({ hasData: true }, { headers: { "x-demiurge-navigation": "data" } });
    }));
    const Router = createFileRouter({
      routes: { "./routes/index.tsx": routeModule({ GET: page(SubmitterActionFormPage) }) },
    });
    render(<Router />);
    const publish = await screen.findByRole("button", { name: "Publish" });
    const submit = new Event("submit", { bubbles: true, cancelable: true });
    Object.defineProperty(submit, "submitter", { value: publish });
    fireEvent((publish as HTMLButtonElement).form!, submit);
    await waitFor(() => expect(calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
    const [url, action] = calls.find(([, init]) => init?.method === "PATCH")!;
    expect(String(url)).toContain("/publish");
    expect(new Headers(action?.headers).get("content-type")).toContain("text/plain");
    expect(action?.body).toBe("title=Draft\r\nintent=publish\r\n");
  });

  it("rejects malformed and credentialed protocol redirects", async () => {
    const responses = [
      new Response("malformed", { headers: { "content-type": "application/vnd.demiurge.action+json;v=2" } }),
      actionResponse({ history: "replace", location: "http://user@localhost/credentialed", status: "redirect", version: 1 }),
    ];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST"
        ? responses.shift()!
        : Response.json({ hasData: true }, { headers: { "x-demiurge-navigation": "data" } }),
    ));
    const replace = vi.spyOn(window.history, "replaceState");
    const Router = createFileRouter({
      routes: { "./routes/index.tsx": routeModule({ GET: page(ProtocolActionFormPage) }) },
    });
    render(<Router />);
    const form = (await screen.findByRole("button", { name: "Save" })).closest("form")!;
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByLabelText("protocol state").textContent).toBe("error"));
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByLabelText("protocol state").textContent).toBe("error"));
    expect(replace).not.toHaveBeenCalled();
  });

  it("ignores a replaced submission after the current key succeeds", async () => {
    const actions: ((response: Response) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return await new Promise<Response>((resolve) => actions.push(resolve));
      return Response.json({ hasData: true }, { headers: { "x-demiurge-navigation": "data" } });
    }));
    const Router = createFileRouter({
      routes: { "./routes/index.tsx": routeModule({ GET: page(ReplaceActionFormPage) }) },
    });
    render(<Router />);
    const form = (await screen.findByRole("button", { name: "Save" })).closest("form")!;
    fireEvent.submit(form);
    await waitFor(() => expect(actions).toHaveLength(1));
    fireEvent.submit(form);
    await waitFor(() => expect(actions).toHaveLength(2));
    actions[1](actionResponse({ data: { saved: "current" }, status: "success", version: 1 }));
    await waitFor(() => expect(screen.getByLabelText("replace result").textContent).toBe("current"));
    actions[0](actionResponse({ data: { issues: [] }, status: "invalid", version: 1 }, 400));
    await waitFor(() => expect(screen.getByLabelText("replace result").textContent).toBe("current"));
  });

  it("leaves targeted, disabled, and image submissions native", async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") throw new Error("unexpected action request");
      return Response.json({ hasData: true }, { headers: { "x-demiurge-navigation": "data" } });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const Router = createFileRouter({
      routes: { "./routes/index.tsx": routeModule({ GET: page(NativeActionFormsPage) }) },
    });
    render(<Router />);
    const targeted = await screen.findByRole("button", { name: "Targeted" });
    const targetSubmit = new Event("submit", { bubbles: true, cancelable: true });
    Object.defineProperty(targetSubmit, "submitter", { value: targeted });
    fireEvent((targeted as HTMLButtonElement).form!, targetSubmit);
    fireEvent.click(screen.getByRole("button", { name: "Image" }));
    fireEvent.click(screen.getByRole("button", { name: "Disabled" }));
    expect(fetchSpy.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
      loadNavigationData: async () => ({
        document: navigationDocument("Missing document"),
        hasData: true,
      }),
      notFound: NotFound,
      routes: {},
    });

    render(<Router />);

    await waitFor(() => {
      expect(screen.getByText("App not found: /missing")).toBeTruthy();
    });
    expect(document.title).toBe("Missing document");
  });

  it("announces a committed navigation and focuses an opted-in boundary", async () => {
    window.history.replaceState(null, "", "/blog");
    document.title = "Initial document";
    const Router = createFileRouter({
      routes: {
        "./routes/@layout.tsx": routeModule({ default: FocusLayout }),
        "./routes/blog.tsx": routeModule({ GET: page(BlogPage) }),
      },
    });

    render(<Router />);

    await waitFor(() => {
      expect(screen.getByText("Blog page at /blog")).toBeTruthy();
      expect(document.querySelector('[role="status"]')?.textContent).toBe(
        "Initial document",
      );
    });
    expect(document.activeElement?.tagName).toBe("MAIN");
    expect(document.activeElement?.getAttribute("tabindex")).toBe("-1");
  });

  it("composes an application ref around the focus boundary", async () => {
    const appRef = vi.fn();
    function RefLayout({ children }: LayoutProps) {
      return <RouteFocusBoundary as="main" ref={appRef}>{children}</RouteFocusBoundary>;
    }
    window.history.replaceState(null, "", "/blog");
    const Router = createFileRouter({
      routes: {
        "./routes/@layout.tsx": routeModule({ default: RefLayout }),
        "./routes/blog.tsx": routeModule({ GET: page(BlogPage) }),
      },
    });

    render(<Router />);
    await waitFor(() => expect(screen.getByText("Blog page at /blog")).toBeTruthy());
    expect(appRef).toHaveBeenCalledWith(expect.any(HTMLElement));
    cleanup();
    expect(appRef).toHaveBeenLastCalledWith(null);
  });

  it("keeps the low-level focus hook safe outside a router", () => {
    function BareHook() {
      const props = useRouteFocusBoundary();
      return <div {...props}>Bare hook</div>;
    }
    render(<BareHook />);
    expect(screen.getByText("Bare hook").getAttribute("tabindex")).toBe("-1");
  });

  it("commits one error announcement after a route render fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    window.history.replaceState(null, "", "/broken");
    document.title = "Initial document";
    const Router = createFileRouter({
      routes: {
        "./routes/@layout.tsx": routeModule({ default: FocusLayout }),
        "./routes/@error.tsx": routeModule({ default: RouteError }),
        "./routes/broken.tsx": routeModule({ GET: page(BrokenPage) }),
      },
    });

    render(<Router />);

    await waitFor(() => {
      expect(screen.getByText("Route error at /broken: render failed")).toBeTruthy();
      expect(document.querySelector("[role=\"status\"]")?.textContent).toBe(
        "Navigation failed",
      );
    });
    expect(document.activeElement?.tagName).not.toBe("MAIN");
  });

  it("does not transition for a cancelled navigation", async () => {
    window.history.replaceState(null, "", "/slow");
    const Router = createFileRouter({
      loadNavigationData: () => new Promise(() => undefined),
      routes: {},
    });

    render(<Router />);
    await waitFor(() => expect(screen.queryByRole("status")).toBeTruthy());
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("does not transition during initial hydration", async () => {
    const Router = createFileRouter({
      initialMatch: {
        status: "ready",
        match: {
          data: undefined,
          error: undefined,
          links: [],
          layouts: [],
          metadata: resolveMetadata(),
          page: HomePage,
          path: {},
          pathname: "/",
          render: { mode: "ssr" },
          scripts: [],
        },
      } as never,
      routes: {},
    });

    render(<Router />);
    expect(screen.getByText("Home")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("");
    expect(document.activeElement?.tagName).not.toBe("MAIN");
  });

  it("renders the built-in not-found UI when no app fallback exists", async () => {
    window.history.replaceState(null, "", "/missing");
    const Router = createFileRouter({ routes: {} });

    render(<Router />);

    await waitFor(() => {
      expect(screen.getByText("No route matched /missing.")).toBeTruthy();
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

  it("does not let a late loading fallback replace a completed navigation", async () => {
    const loadingResolver = deferred<Record<string, unknown>>();
    const Router = createFileRouter({
      routes: {
        "./routes/@loading.tsx": vi.fn(() => loadingResolver.promise),
        "./routes/blog/index.tsx": routeModule({ GET: page(BlogPage) }),
      },
    });

    window.history.replaceState(null, "", "/blog");
    render(<Router />);

    await waitFor(() => {
      expect(screen.getByText("Blog page at /blog")).toBeTruthy();
    });

    loadingResolver.resolve({ default: RouteLoading });
    await Promise.resolve();

    expect(screen.queryByText("Route loading")).toBeNull();
    expect(screen.getByText("Blog page at /blog")).toBeTruthy();
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

  it("clears loading UI when a route fails without an error fallback", async () => {
    window.history.replaceState(null, "", "/blog");
    const Router = createFileRouter({
      loading: Loading,
      routes: {
        "./routes/blog/index.tsx": vi.fn(async () => {
          throw new Error("load failed");
        }),
      },
    });

    render(<Router />);
    expect(screen.getByText("App loading")).toBeTruthy();

    await waitFor(() => {
      expect(screen.queryByText("App loading")).toBeNull();
    });
  });

  it("resets a rendered route error after navigating to another pathname", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    window.history.replaceState(null, "", "/broken");
    const Router = createFileRouter({
      routes: {
        "./routes/@error.tsx": routeModule({ default: RouteError }),
        "./routes/blog/index.tsx": routeModule({ GET: page(BlogPage) }),
        "./routes/broken.tsx": routeModule({ GET: page(BrokenPage) }),
      },
    });

    render(<Router />);
    await waitFor(() => {
      expect(screen.getByText("Route error at /broken: render failed")).toBeTruthy();
    });

    window.history.pushState(null, "", "/blog");
    window.dispatchEvent(new PopStateEvent("popstate"));

    await waitFor(() => {
      expect(screen.getByText("Blog page at /blog")).toBeTruthy();
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

  it("renders malformed encoded paths through the root error boundary", async () => {
    window.history.replaceState(null, "", "/items/%E0%A4%A");
    const Router = createFileRouter({
      loadNavigationData: async () => {
        throw httpError(400, { title: "Bad Request" });
      },
      routes: {
        "./routes/@error.tsx": routeModule({ default: StatusError }),
        "./routes/items/[id].tsx": routeModule({ GET: page(BlogPage) }),
      },
    });

    render(<Router />);

    await waitFor(() => {
      expect(screen.getByText("Route status: 400")).toBeTruthy();
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

  it("uses the real origin and reruns navigation data for query changes", async () => {
    window.history.replaceState(null, "", "/?q=first");
    const requests: Request[] = [];
    const Router = createFileRouter({
      loadNavigationData: async (request) => {
        requests.push(request);
        return {
          data: new URL(request.url).searchParams.get("q"),
          hasData: true,
        };
      },
      routes: {
        "./routes/index.tsx": routeModule({
          GET: page<string, string>({
            data: () => {
              throw new Error("Page data must not run in the browser.");
            },
            view: QueryPage,
          }),
        }),
      },
    });

    render(<Router />);
    await waitFor(() => expect(screen.getByText("Query: first")).toBeTruthy());
    fireEvent.click(screen.getByText("Next query"));
    await waitFor(() => expect(screen.getByText("Query: second")).toBeTruthy());

    expect(requests.map((request) => request.url)).toEqual([
      "http://localhost:3000/?q=first",
      "http://localhost:3000/?q=second",
    ]);
  });

  it("never resolves server document contributions in the browser", async () => {
    const layoutLinks = vi.fn(() => {
      throw new Error("Layout links must not run in the browser.");
    });
    const layoutScripts = vi.fn(() => {
      throw new Error("Layout scripts must not run in the browser.");
    });
    const pageLinks = vi.fn(() => {
      throw new Error("Page links must not run in the browser.");
    });
    const pageScripts = vi.fn(() => {
      throw new Error("Page scripts must not run in the browser.");
    });
    const Router = createFileRouter({
      loadNavigationData: async () => ({
        data: "from server",
        document: {
          links: [{ href: "/server.css", kind: "link", rel: "stylesheet" }],
          metadata: resolveMetadata({
            description: "Resolved on the server",
            title: "Server contribution",
          }),
          scripts: [],
          title: "Server contribution",
        },
        hasData: true,
      }),
      routes: {
        "./routes/@layout.tsx": routeModule({
          default: RootLayout,
          links: defineLinks(layoutLinks),
          scripts: defineScripts(layoutScripts),
        }),
        "./routes/index.tsx": routeModule({
          GET: page<string, string>({
            data: () => {
              throw new Error("Page data must not run in the browser.");
            },
            view: QueryPage,
          }),
          links: defineLinks(pageLinks),
          scripts: defineScripts(pageScripts),
        }),
      },
    });

    render(<Router />);
    await waitFor(() => expect(screen.getByText("Query: from server")).toBeTruthy());

    expect(layoutLinks).not.toHaveBeenCalled();
    expect(layoutScripts).not.toHaveBeenCalled();
    expect(pageLinks).not.toHaveBeenCalled();
    expect(pageScripts).not.toHaveBeenCalled();
    expect(document.title).toBe("Server contribution");
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute("content"))
      .toBe("Resolved on the server");
    expect(document.head.querySelector('link[href="/server.css"]')).toBeTruthy();
  });

  it("does not reload route data for a hash-only navigation", async () => {
    const loadNavigationData = vi.fn(async () => ({ hasData: true }));
    const scrollIntoView = vi.fn();
    const Router = createFileRouter({
      loadNavigationData,
      routes: {
        "./routes/index.tsx": routeModule({ GET: page(HashPage) }),
      },
    });

    render(<Router />);
    await waitFor(() => expect(screen.getByText("Jump")).toBeTruthy());
    const initialAnnouncement = document.querySelector("[role=\"status\"]")?.textContent;
    const section = document.getElementById("section");
    Object.defineProperty(section, "scrollIntoView", { value: scrollIntoView });
    fireEvent.click(screen.getByText("Jump"));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));

    expect(window.location.hash).toBe("#section");
    expect(loadNavigationData).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[role=\"status\"]")?.textContent).toBe(initialAnnouncement);
  });

  it("cannot commit a superseded navigation after the new route finishes", async () => {
    const first = deferred<{ hasData: true }>();
    const second = deferred<{ hasData: true }>();
    const Router = createFileRouter({
      loadNavigationData: async (request) => {
        const pathname = new URL(request.url).pathname;
        if (pathname === "/first") return first.promise;
        if (pathname === "/second") return second.promise;
        return { hasData: true };
      },
      routes: {
        "./routes/index.tsx": routeModule({ GET: page(HomePage) }),
        "./routes/first.tsx": routeModule({ GET: page(FirstPage) }),
        "./routes/second.tsx": routeModule({ GET: page(SecondPage) }),
      },
    });

    render(<Router />);
    await waitFor(() => expect(screen.getByText("Home")).toBeTruthy());

    window.history.pushState(null, "", "/first");
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.history.pushState(null, "", "/second");
    window.dispatchEvent(new PopStateEvent("popstate"));
    second.resolve({ hasData: true });
    await waitFor(() => expect(screen.getByText("Second page")).toBeTruthy());
    first.resolve({ hasData: true });
    await Promise.resolve();

    expect(screen.queryByText("First page")).toBeNull();
    expect(screen.getByText("Second page")).toBeTruthy();
  });

  it("cannot apply an error document from a superseded navigation", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/first") return await first.promise;
      if (pathname === "/second") return await second.promise;
      return navigationResponse("Home document");
    }));
    const Router = createFileRouter({
      routes: {
        "./routes/@error.tsx": routeModule({ default: StatusError }),
        "./routes/index.tsx": routeModule({ GET: page(HomePage) }),
        "./routes/first.tsx": routeModule({ GET: page(FirstPage) }),
        "./routes/second.tsx": routeModule({ GET: page(SecondPage) }),
      },
    });

    render(<Router />);
    await waitFor(() => expect(screen.getByText("Home")).toBeTruthy());

    window.history.pushState(null, "", "/first");
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.history.pushState(null, "", "/second");
    window.dispatchEvent(new PopStateEvent("popstate"));
    second.resolve(navigationResponse("Second document"));
    await waitFor(() => expect(document.title).toBe("Second document"));

    first.resolve(Response.json(
      {
        document: navigationDocument("Stale error document"),
        error: { title: "Internal Server Error" },
        hasData: true,
      },
      {
        headers: { "x-demiurge-navigation": "error" },
        status: 500,
      },
    ));
    await Promise.resolve();
    await Promise.resolve();

    expect(document.title).toBe("Second document");
    expect(screen.getByText("Second page")).toBeTruthy();
  });

  it("applies the error document for the current navigation", async () => {
    window.history.replaceState(null, "", "/broken");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(
      {
        document: navigationDocument("Error document"),
        error: { title: "Service Unavailable" },
        hasData: true,
      },
      {
        headers: { "x-demiurge-navigation": "error" },
        status: 503,
      },
    )));
    const Router = createFileRouter({
      routes: {
        "./routes/@error.tsx": routeModule({ default: StatusError }),
        "./routes/broken.tsx": routeModule({ GET: page(BrokenPage) }),
      },
    });

    render(<Router />);

    await waitFor(() => expect(screen.getByText("Route status: 503")).toBeTruthy());
    expect(document.title).toBe("Error document");
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

  it("composes anchor behavior before internal navigation", async () => {
    const onClick = vi.fn((event: React.MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
    });
    const Router = createFileRouter({
      routes: {
        "./routes/index.tsx": routeModule({
          GET: page(() => (
            <Link
              aria-label="Account settings"
              data-navigation-kind="account"
              id="account-link"
              onClick={onClick}
              ref={(element) => element?.setAttribute("data-has-ref", "true")}
              to="/blog"
            >
              Account
            </Link>
          )),
        }),
        "./routes/blog/index.tsx": routeModule({ GET: page(BlogPage) }),
      },
    });

    render(<Router />);
    const link = await screen.findByRole("link", { name: "Account settings" });

    expect(link.getAttribute("data-navigation-kind")).toBe("account");
    expect(link.getAttribute("data-has-ref")).toBe("true");
    fireEvent.click(link);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/");
  });

  it.each<[string, LinkProps]>([
    ["target", { target: "_blank", to: "/blog" }],
    ["download", { download: true, to: "/blog" }],
    ["external origin", runtimeLinkProps("https://example.test/blog")],
    ["non-HTTP scheme", runtimeLinkProps("mailto:team@example.test")],
    ["reload request", { reloadDocument: true, to: "/blog" }],
  ])("leaves %s links to native navigation", async (_name, linkProps) => {
    const pushState = vi.spyOn(window.history, "pushState");
    const Router = createFileRouter({
      routes: {
        "./routes/index.tsx": routeModule({
          GET: page(() => <Link {...linkProps}>Native</Link>),
        }),
      },
    });

    render(<Router />);
    const link = await screen.findByText("Native");
    window.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
    link.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      button: 0,
      cancelable: true,
    }));

    expect(pushState).not.toHaveBeenCalled();
  });
});

function routeModule(module: Record<string, unknown>) {
  return async () => module;
}

function runtimeLinkProps(to: string) {
  // TYPE-EVIDENCE: this helper exercises runtime protection for a destination that generated application route types reject at compile time.
  return { to } as LinkProps;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

function navigationDocument(title: string) {
  return {
    links: [],
    metadata: resolveMetadata({ title }),
    scripts: [],
    title,
  };
}

function navigationResponse(title: string) {
  return Response.json(
    { document: navigationDocument(title), hasData: true },
    { headers: { "x-demiurge-navigation": "data" } },
  );
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

function FocusLayout({ children }: LayoutProps) {
  return <RouteFocusBoundary as="main">{children}</RouteFocusBoundary>;
}

function HomePage(_props: RouteProps) {
  return (
    <>
      <h1>Home</h1>
      <Link to="/blog">Blog</Link>
    </>
  );
}

function ActionFormPage() {
  const navigation = useNavigation({ submissionKey: "action-form" });
  return (
    <Form action="/" method="post" submissionKey="action-form" aria-label="action form">
      <input name="title" defaultValue="Draft" />
      <button type="submit">Save</button>
      <output>{navigation.state}</output>
    </Form>
  );
}

function RefreshActionFormPage() {
  const navigation = useFormNavigation<{ saved: string }>("refresh-action");
  return (
    <>
      <Form action="/save" method="post" submissionKey="refresh-action">
        <RefreshActionFormState />
        <button type="submit">Save</button>
      </Form>
      <output aria-label="action result">
        {navigation.state === "idle" && navigation.result?.status === "success"
          ? navigation.result.data?.saved
          : ""}
      </output>
    </>
  );
}

function RefreshActionFormState() {
  const navigation = useFormNavigation();
  return <output aria-label="context state">{navigation.state}</output>;
}

function UnmountActionFormPage() {
  const [visible, setVisible] = useState(true);
  const navigation = useFormNavigation("unmount-action");
  return (
    <>
      {visible ? (
        <Form action="/save" method="post" submissionKey="unmount-action">
          <button type="submit">Save</button>
        </Form>
      ) : null}
      <button onClick={() => setVisible(false)} type="button">Remove</button>
      <output aria-label="unmount state">{navigation.state}</output>
    </>
  );
}

function SubmitterActionFormPage() {
  return (
    <Form action="/draft" method="post">
      <input name="title" defaultValue="Draft" />
      <button formAction="/publish" formEncType="text/plain" formMethod="patch" name="intent" type="submit" value="publish">
        Publish
      </button>
    </Form>
  );
}

function ProtocolActionFormPage() {
  return <Form action="/save" method="post"><ProtocolActionFormState /><button type="submit">Save</button></Form>;
}

function ProtocolActionFormState() {
  const navigation = useFormNavigation();
  return <output aria-label="protocol state">{navigation.state}</output>;
}

function ReplaceActionFormPage() {
  const navigation = useFormNavigation<{ saved: string }>("replace-action");
  return (
    <>
      <Form action="/save" method="post" submissionKey="replace-action"><button type="submit">Save</button></Form>
      <output aria-label="replace result">
        {navigation.state === "idle" && navigation.result?.status === "success"
          ? navigation.result.data?.saved
          : ""}
      </output>
    </>
  );
}

function NativeActionFormsPage() {
  return (
    <>
      <Form action="/target" method="post"><button formTarget="_blank" type="submit">Targeted</button></Form>
      <Form action="/image" method="post"><input alt="Image" src="/image.png" type="image" /></Form>
      <Form action="/disabled" method="post"><button disabled type="submit">Disabled</button></Form>
    </>
  );
}

function actionResponse(value: object, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/vnd.demiurge.action+json;v=1" },
    status,
  });
}

function ExternalFormPage() {
  return <Form action="https://other.example/save" method="post"><button type="submit">Save</button></Form>;
}

function EncodingFormsPage() {
  return (
    <>
      <Form action="/" method="post" encType="multipart/form-data" aria-label="multipart action">
        <input name="title" defaultValue="Draft" />
      </Form>
      <Form action="/" method="post" encType="text/plain" aria-label="text action">
        <input name="title" defaultValue="Draft" />
      </Form>
    </>
  );
}

function BlogPage({ pathname }: RouteProps) {
  return <p>Blog page at {pathname}</p>;
}

function QueryPage({ data }: RouteProps<string, string>) {
  return (
    <>
      <p>Query: {data}</p>
      <Link to="/" search={{ q: "second" }}>Next query</Link>
    </>
  );
}

function HashPage() {
  return (
    <>
      <Link hash="section" to="/">Jump</Link>
      <div id="section">Section</div>
    </>
  );
}

function FirstPage() {
  return <p>First page</p>;
}

function SecondPage() {
  return <p>Second page</p>;
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
