// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { useFormStatus } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMutationAction,
  Form,
  MutationSubmit,
  type MutationResult,
  type PathValue,
  type RouteMutationMethods,
  useMutationAction,
} from "@demiurgejs/core";
import {
  abortMutationActions,
  readMutationResult,
  registerMutationRouter,
  validateMutationRedirect,
} from "../../src/browser/mutation-action";

declare module "@demiurgejs/core" {
  interface RoutePathVars {
    "/items/[id]": { id: PathValue };
  }

  interface RouteMutationMethods {
    "/items/[id]": {
      PATCH: { data: unknown; fields: "title" };
      POST: { data: unknown; fields: "title" };
    };
  }
}

describe("mutation actions", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends the original FormData with credentials and a cancellation signal", async () => {
    const formData = new FormData();
    formData.append("title", "Current title");
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => mutationResponse({
      data: { saved: true },
      status: "success",
      version: 1,
    }));
    vi.stubGlobal("fetch", fetchSpy);
    const action = createMutationAction<{ saved: boolean }, "/items/[id]">({
      method: "PATCH",
      path: { id: 42 },
      route: "/items/[id]",
    });

    await expect(action(undefined, formData)).resolves.toMatchObject({
      data: { saved: true },
      status: "success",
    });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(init).toBeDefined();
    expect(url).toBe("/items/42");
    expect(init?.body).toBe(formData);
    expect(init?.credentials).toBe("same-origin");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init?.headers).has("content-type")).toBe(false);
  });

  it("makes an obsolete call adopt the newest result", async () => {
    const responses: ((response: Response) => void)[] = [];
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      return await new Promise<Response>((resolve) => responses.push(resolve));
    }));
    const action = createMutationAction({
      method: "PATCH",
      path: { id: 1 },
      route: "/items/[id]",
    });

    const first = action(undefined, new FormData());
    const second = action(undefined, new FormData());
    expect(signals[0]?.aborted).toBe(true);
    responses[0]!(mutationResponse({ data: "old", status: "success", version: 1 }));
    responses[1]!(mutationResponse({ data: "new", status: "success", version: 1 }));

    await expect(first).resolves.toMatchObject({ data: "new" });
    await expect(second).resolves.toMatchObject({ data: "new" });
  });

  it("rejects an unsupported protocol representation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      status: "success",
      version: 1,
    })));
    const action = createMutationAction({
      method: "PATCH",
      path: { id: 1 },
      route: "/items/[id]",
    });

    await expect(action(undefined, new FormData())).rejects.toThrow(
      "expected a versioned mutation result",
    );
  });

  it("applies safe redirects through the registered router", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mutationResponse({
      history: "replace",
      location: "/saved",
      status: "redirect",
      version: 1,
    })));
    const redirect = vi.fn();
    const unregister = registerMutationRouter({ redirect, refresh: vi.fn() });
    const action = createMutationAction({
      method: "PATCH",
      path: { id: 1 },
      route: "/items/[id]",
    });

    await expect(action(undefined, new FormData())).resolves.toMatchObject({
      status: "redirect",
    });
    expect(redirect).toHaveBeenCalledWith(
      "/saved",
      "replace",
      expect.any(AbortController),
    );
    unregister();
    unregister();
  });

  it("waits for a requested route refresh", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mutationResponse({
      revalidate: true,
      status: "success",
      version: 1,
    })));
    const refresh = vi.fn(async () => undefined);
    const unregister = registerMutationRouter({ redirect: vi.fn(), refresh });
    const action = createMutationAction({
      method: "PATCH",
      path: { id: 1 },
      route: "/items/[id]",
    });

    await expect(action(undefined, new FormData())).resolves.toMatchObject({
      status: "success",
    });
    expect(refresh).toHaveBeenCalledOnce();
    unregister();
  });

  it("returns the prior state when navigation cancels a request", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) =>
      await new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })));
    const action = createMutationAction({
      method: "PATCH",
      path: { id: 1 },
      route: "/items/[id]",
    });
    const previous = { data: "saved", status: "success", version: 1 } as const;
    const result = action(previous, new FormData());

    abortMutationActions();

    await expect(result).resolves.toBe(previous);
  });

  it("returns a failed result when navigation cancels the initial request", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) =>
      await new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })));
    const action = createMutationAction({
      method: "PATCH",
      path: { id: 1 },
      route: "/items/[id]",
    });
    const result = action(undefined, new FormData());

    abortMutationActions();

    await expect(result).resolves.toMatchObject({
      message: "The mutation was cancelled.",
      status: "failed",
    });
  });

  it("exposes only generated mutation methods", () => {
    type ItemMethods = keyof RouteMutationMethods["/items/[id]"];
    const method: ItemMethods = "PATCH";
    expect(method).toBe("PATCH");
  });

  it("keeps unmarked application responses outside the mutation protocol", async () => {
    await expect(readMutationResult(Response.json({ saved: true }))).resolves.toBeUndefined();
    await expect(readMutationResult(new Response(null))).resolves.toBeUndefined();
  });

  it.each([
    ["an unsupported version", { status: "success", version: 1 }, "application/vnd.demiurge.mutation+json;v=2", "malformed versioned"],
    ["invalid JSON", "not JSON", "application/vnd.demiurge.mutation+json;v=1", "malformed versioned"],
    ["an invalid envelope", { status: "success", version: 2 }, "application/vnd.demiurge.mutation+json;v=1", "malformed versioned"],
    ["an invalid refresh flag", { revalidate: "yes", status: "success", version: 1 }, "application/vnd.demiurge.mutation+json;v=1", "malformed mutation result"],
    ["an extra success field", { extra: true, status: "success", version: 1 }, "application/vnd.demiurge.mutation+json;v=1", "malformed mutation result"],
    ["missing validation", { status: "invalid", version: 1 }, "application/vnd.demiurge.mutation+json;v=1", "malformed mutation result"],
    ["an invalid issue path", { status: "invalid", validation: { issues: [{ code: "required", message: "Required", path: [0] }] }, version: 1 }, "application/vnd.demiurge.mutation+json;v=1", "malformed mutation result"],
    ["an invalid failure message", { message: 5, status: "failed", version: 1 }, "application/vnd.demiurge.mutation+json;v=1", "malformed mutation result"],
    ["an invalid redirect", { history: "push", status: "redirect", version: 1 }, "application/vnd.demiurge.mutation+json;v=1", "malformed mutation result"],
    ["an unknown status", { status: "other", version: 1 }, "application/vnd.demiurge.mutation+json;v=1", "malformed mutation result"],
  ])("rejects %s", async (_name, body, contentType, message) => {
    const response = new Response(
      typeof body === "string" ? body : JSON.stringify(body),
      { headers: { "content-type": contentType } },
    );
    await expect(readMutationResult(response)).rejects.toThrow(message);
  });

  it.each([
    [{ status: "invalid", validation: { issues: [{ code: "required", message: "Required", path: ["title"] }] }, version: 1 }, "invalid"],
    [{ message: "Try again", status: "failed", version: 1 }, "failed"],
    [{ history: "replace", location: "/saved", status: "redirect", version: 1 }, "redirect"],
  ])("reads a %s protocol result", async (body, status) => {
    await expect(readMutationResult(mutationResponse(body))).resolves.toMatchObject({ status });
  });

  it("accepts only safe same-origin redirects", () => {
    expect(validateMutationRedirect("/saved?ok=yes#result")).toBe("/saved?ok=yes#result");
    expect(validateMutationRedirect("https://other.example/saved")).toBeUndefined();
    expect(validateMutationRedirect("http://localhost/saved")).toBeUndefined();
    expect(validateMutationRedirect("https://user:secret@localhost/saved")).toBeUndefined();
    expect(validateMutationRedirect("http://[invalid")).toBeUndefined();
  });

  it("preserves application field names in invalid results", () => {
    const result: MutationResult<{ saved: boolean }, "title"> = {
      status: "invalid",
      validation: { issues: [{ code: "required", message: "Required", path: ["title"] }] },
      version: 1,
    };
    expect(result.validation.issues[0]?.path[0]).toBe("title");

    const action = createMutationAction({
      method: "PATCH",
      path: { id: 1 },
      route: "/items/[id]",
    });
    type ActionResult = Awaited<ReturnType<typeof action>>;
    const inferred: Extract<ActionResult, { status: "invalid" }> = result;
    expect(action).toBeTypeOf("function");
    expect(inferred.validation.issues[0]?.path[0]).toBe("title");
  });

  it("renders real fallback destinations for a progressive form and submitter", () => {
    const html = renderToString(createElement(ProgressiveMutationForm));
    expect(html).toContain('action="/items/1"');
    expect(html).toContain('method="post"');
    expect(html).toContain('formAction="/items/2"');
  });

  it("provides pending FormData through React useFormStatus", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn(async () => await new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    })));
    render(createElement(ProgressiveMutationForm));
    const form = screen.getByRole("form");
    const submit = new Event("submit", { bubbles: true, cancelable: true });
    Object.defineProperty(submit, "submitter", {
      value: screen.getByRole("button", { name: "Save" }),
    });
    fireEvent(form, submit);

    await waitFor(() => expect(screen.getByTestId("form-pending").textContent).toBe("pending:Draft"));
    resolveResponse?.(mutationResponse({ status: "success", version: 1 }));
    await waitFor(() => expect(screen.getByTestId("form-pending").textContent).toBe("idle"));
  });
});

function ProgressiveMutationForm() {
  const [, save] = useMutationAction({
    method: "POST",
    path: { id: 1 },
    route: "/items/[id]",
  });
  const [, publish] = useMutationAction({
    method: "POST",
    path: { id: 2 },
    route: "/items/[id]",
  });
  return createElement(Form, {
    action: save,
    "aria-label": "progressive mutation",
    children: [
      createElement("input", { defaultValue: "Draft", key: "title", name: "title" }),
      createElement(FormStatus, { key: "status" }),
      createElement("button", { children: "Save", key: "save", type: "submit" }),
      createElement(MutationSubmit, {
        children: "Publish",
        formAction: publish,
        key: "publish",
        name: "intent",
        value: "publish",
      }),
    ],
  });
}

function FormStatus() {
  const status = useFormStatus();
  return createElement("output", {
    "data-testid": "form-pending",
    children: status.pending ? `pending:${status.data.get("title")}` : "idle",
  });
}

function mutationResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/vnd.demiurge.mutation+json;v=1" },
  });
}
