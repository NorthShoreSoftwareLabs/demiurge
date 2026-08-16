import { describe, expect, it, vi } from "vitest";
import {
  action,
  actionInput,
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
});
