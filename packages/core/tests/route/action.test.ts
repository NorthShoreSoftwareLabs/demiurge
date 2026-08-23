import { describe, expect, it, vi } from "vitest";
import {
  action,
  actionInput,
  ActionValidationError,
  ACTION_REQUEST_HEADER,
  ACTION_REQUEST_VALUE,
  ACTION_RESPONSE_MEDIA_TYPE,
  createMemoryIdempotencyStore,
  json,
  redirect,
  toResponse,
  type HttpRouteContext,
} from "@demiurgejs/core";

function createContext(request: Request): HttpRouteContext {
  const url = new URL(request.url);

  return {
    context: {},
    path: {},
    pathname: url.pathname,
    request,
    search: url.searchParams,
    url,
  };
}

describe("action helper", () => {
  it("returns a versioned invalid result for protocol requests", async () => {
    const capability = action({
      input: async () => {
        throw new ActionValidationError([{
          code: "required",
          message: "Title is required",
          path: ["title"],
        }]);
      },
      handler: () => new Response("unreachable"),
    });
    const response = await toResponse(capability, createContext(new Request(
      "https://example.test/posts",
      { headers: { [ACTION_REQUEST_HEADER]: ACTION_REQUEST_VALUE }, method: "POST" },
    )));
    expect(response.headers.get("content-type")).toContain("v=1");
    await expect(response.json()).resolves.toMatchObject({
      version: 1,
      status: "invalid",
    });
  });

  it("returns a versioned redirect for protocol requests", async () => {
    const capability = action({ handler: () => redirect("/posts", 303) });
    const response = await toResponse(capability, createContext(new Request(
      "https://example.test/posts",
      { headers: { [ACTION_REQUEST_HEADER]: ACTION_REQUEST_VALUE }, method: "POST" },
    )));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      version: 1,
      status: "redirect",
      location: "/posts",
      history: "push",
    });
  });

  it("uses replace only for permanent action redirects", async () => {
    const capability = action({ handler: () => redirect("/posts", 308) });
    const response = await toResponse(capability, createContext(new Request(
      "https://example.test/posts",
      { headers: { [ACTION_REQUEST_HEADER]: ACTION_REQUEST_VALUE }, method: "POST" },
    )));

    await expect(response.json()).resolves.toEqual({
      version: 1,
      status: "redirect",
      location: "/posts",
      history: "replace",
    });
  });

  it("marks protocol success results for route revalidation", async () => {
    const capability = action({
      revalidateRoute: true,
      handler: () => json({ saved: true }),
    });
    const response = await toResponse(capability, createContext(new Request(
      "https://example.test/posts",
      { headers: { [ACTION_REQUEST_HEADER]: ACTION_REQUEST_VALUE }, method: "POST" },
    )));
    await expect(response.json()).resolves.toMatchObject({
      version: 1,
      status: "success",
      data: { saved: true },
      revalidate: true,
    });
  });

  it("keeps cache-tag invalidation separate from browser route revalidation", async () => {
    const capability = action({
      revalidate: [{ id: "posts" }],
      revalidateRoute: true,
      handler: () => json({ saved: true }),
    });
    const response = await toResponse(capability, createContext(new Request(
      "https://example.test/posts",
      { headers: { [ACTION_REQUEST_HEADER]: ACTION_REQUEST_VALUE }, method: "POST" },
    )));

    expect(response.headers.get("x-demiurge-revalidate-tags")).toBe("posts");
    expect(response.headers.get("content-type")).toBe(ACTION_RESPONSE_MEDIA_TYPE);
    await expect(response.json()).resolves.toMatchObject({
      version: 1,
      status: "success",
      revalidate: true,
    });
  });

  it("keeps a raw response opaque for protocol requests", async () => {
    const capability = action({
      handler: () => new Response("raw action response", {
        headers: { "content-type": "text/plain" },
        status: 422,
      }),
    });
    const response = await toResponse(capability, createContext(new Request(
      "https://example.test/posts",
      { headers: { [ACTION_REQUEST_HEADER]: ACTION_REQUEST_VALUE }, method: "POST" },
    )));

    expect(response.headers.get("content-type")).toBe("text/plain");
    await expect(response.text()).resolves.toBe("raw action response");
  });

  it("returns a stable response for application validation errors", async () => {
    const capability = action({
      input: async () => {
        throw new ActionValidationError([{
          code: "required",
          message: "Title is required",
          path: ["title"],
        }]);
      },
      handler: () => new Response("unreachable"),
    });

    const response = await toResponse(
      capability,
      createContext(new Request("https://example.test/posts", { method: "POST" })),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      issues: [{ code: "required", message: "Title is required", path: ["title"] }],
      type: "validation-error",
    });
  });
  it("parses JSON input and returns response capabilities", async () => {
    const capability = action({
      input: actionInput.json,
      handler({ input }) {
        return json({
          received: input,
        });
      },
    });
    const response = await toResponse(
      capability,
      createContext(
        new Request("https://example.test/posts", {
          body: JSON.stringify({ title: "Hello" }),
          method: "POST",
        }),
      ),
    );

    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    await expect(response.json()).resolves.toEqual({
      received: {
        title: "Hello",
      },
    });
  });

  it("supports form and text action inputs", async () => {
    const formCapability = action({
      input: actionInput.formData,
      handler({ input }) {
        return json({
          title: input.get("title"),
        });
      },
    });
    const textCapability = action({
      input: actionInput.text,
      handler({ input }) {
        return new Response(input.toUpperCase());
      },
    });
    const form = new FormData();
    form.set("title", "Hello");

    const formResponse = await toResponse(
      formCapability,
      createContext(
        new Request("https://example.test/posts", {
          body: form,
          method: "POST",
        }),
      ),
    );
    const textResponse = await toResponse(
      textCapability,
      createContext(
        new Request("https://example.test/posts", {
          body: "hello",
          method: "POST",
        }),
      ),
    );

    await expect(formResponse.json()).resolves.toEqual({ title: "Hello" });
    await expect(textResponse.text()).resolves.toBe("HELLO");
  });

  it("replays idempotent action responses for matching keys", async () => {
    const store = createMemoryIdempotencyStore();
    const createPost = vi.fn(async () =>
      redirect(`/posts/${createPost.mock.calls.length}`, 303),
    );
    const capability = action({
      idempotency: {
        key: ({ request }) => [
          "create-post",
          request.headers.get("idempotency-key"),
        ],
        store,
        ttl: "1h",
      },
      handler: createPost,
    });
    const request = new Request("https://example.test/posts", {
      headers: {
        "idempotency-key": "retry-key",
      },
      method: "POST",
    });

    const first = await toResponse(capability, createContext(request.clone()));
    const second = await toResponse(capability, createContext(request.clone()));

    expect(first.status).toBe(303);
    expect(first.headers.get("location")).toBe("/posts/1");
    expect(second.status).toBe(303);
    expect(second.headers.get("location")).toBe("/posts/1");
    expect(createPost).toHaveBeenCalledTimes(1);
  });

  it("does not replay failed idempotent actions", async () => {
    const store = createMemoryIdempotencyStore();
    const createPost = vi
      .fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(json({ ok: true }));
    const capability = action({
      idempotency: {
        key: ["create-post", "retry-key"],
        store,
      },
      handler: createPost,
    });
    const context = createContext(
      new Request("https://example.test/posts", {
        method: "POST",
      }),
    );

    await expect(toResponse(capability, context)).rejects.toThrow("unavailable");

    const response = await toResponse(capability, context);

    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(createPost).toHaveBeenCalledTimes(2);
  });

  it("declares the cache tags that a successful mutation revalidates", async () => {
    const capability = action({
      revalidate: [{ id: "posts" }],
      handler: () => new Response("ok"),
    });

    const response = await toResponse(
      capability,
      createContext(new Request("https://example.test/posts", { method: "POST" })),
    );

    expect(response.headers.get("x-demiurge-revalidate-tags")).toBe("posts");
  });
});
