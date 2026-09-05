import { describe, expect, it, vi } from "vitest";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
  mutation,
  mutationInput,
  MutationValidationError,
  MUTATION_REQUEST_HEADER,
  MUTATION_REQUEST_VALUE,
  MUTATION_RESPONSE_MEDIA_TYPE,
  createMemoryIdempotencyStore,
  json,
  redirect,
  response,
  toResponse,
  type HttpRouteContext,
  type MutationCapability,
  type MutationMethodsOf,
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

describe("mutation helper", () => {
  it("brands the accepted JSON result type for generated route declarations", () => {
    const POST = mutation({
      publicData: true,
      handler: () => json({ saved: true }),
      input: mutationInput.custom<"title", undefined>(() => undefined),
    });
    const typed: MutationCapability<{ saved: boolean }, "title"> = POST;
    const methods: MutationMethodsOf<{ POST: typeof POST; GET: string }> = {
      POST: { data: { saved: true }, fields: "title" },
    };

    expect(typed.kind).toBe("response");
    expect(methods.POST.data.saved).toBe(true);
  });

  it("returns a versioned invalid result for protocol requests", async () => {
    const capability = mutation({
      input: async () => {
        throw new MutationValidationError<"title">({
          issues: [{
            code: "required",
            message: "Title is required",
            path: ["title"],
          }],
        });
      },
      handler: () => new Response("unreachable"),
    });
    const response = await toResponse(capability, createContext(new Request(
      "https://example.test/posts",
      { headers: { [MUTATION_REQUEST_HEADER]: MUTATION_REQUEST_VALUE }, method: "POST" },
    )));
    expect(response.headers.get("content-type")).toContain("v=1");
    await expect(response.json()).resolves.toMatchObject({
      version: 1,
      status: "invalid",
      validation: {
        issues: [{ path: ["title"] }],
      },
    });
  });

  it("returns a versioned redirect for protocol requests", async () => {
    const capability = mutation({ handler: () => redirect("/posts", 303) });
    const response = await toResponse(capability, createContext(new Request(
      "https://example.test/posts",
      { headers: { [MUTATION_REQUEST_HEADER]: MUTATION_REQUEST_VALUE }, method: "POST" },
    )));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      version: 1,
      status: "redirect",
      location: "/posts",
      history: "push",
    });
  });

  it("uses replace only for permanent mutation redirects", async () => {
    const capability = mutation({ handler: () => redirect("/posts", 308) });
    const response = await toResponse(capability, createContext(new Request(
      "https://example.test/posts",
      { headers: { [MUTATION_REQUEST_HEADER]: MUTATION_REQUEST_VALUE }, method: "POST" },
    )));

    await expect(response.json()).resolves.toEqual({
      version: 1,
      status: "redirect",
      location: "/posts",
      history: "replace",
    });
  });

  it("marks protocol success results for route revalidation", async () => {
    const capability = mutation({
      publicData: true,
      revalidateRoute: true,
      handler: () => json({ saved: true }),
    });
    const response = await toResponse(capability, createContext(new Request(
      "https://example.test/posts",
      { headers: { [MUTATION_REQUEST_HEADER]: MUTATION_REQUEST_VALUE }, method: "POST" },
    )));
    await expect(response.json()).resolves.toMatchObject({
      version: 1,
      status: "success",
      data: { saved: true },
      revalidate: true,
    });
  });

  it("keeps cache-tag invalidation separate from browser route revalidation", async () => {
    const capability = mutation({
      publicData: true,
      revalidate: { tags: [{ id: "posts" }] },
      revalidateRoute: true,
      handler: () => json({ saved: true }),
    });
    const response = await toResponse(capability, createContext(new Request(
      "https://example.test/posts",
      { headers: { [MUTATION_REQUEST_HEADER]: MUTATION_REQUEST_VALUE }, method: "POST" },
    )));

    expect(readRevalidation(response)).toEqual({
      keys: [],
      tags: ["posts"],
      version: 1,
    });
    expect(response.headers.get("content-type")).toBe(MUTATION_RESPONSE_MEDIA_TYPE);
    await expect(response.json()).resolves.toMatchObject({
      version: 1,
      status: "success",
      revalidate: true,
    });
  });

  it("keeps a raw response opaque for protocol requests", async () => {
    const capability = mutation({
      handler: () => new Response("raw mutation response", {
        headers: { "content-type": "text/plain" },
        status: 422,
      }),
    });
    const response = await toResponse(capability, createContext(new Request(
      "https://example.test/posts",
      { headers: { [MUTATION_REQUEST_HEADER]: MUTATION_REQUEST_VALUE }, method: "POST" },
    )));

    expect(response.headers.get("content-type")).toBe("text/plain");
    await expect(response.text()).resolves.toBe("raw mutation response");
  });

  it("keeps a response capability opaque for protocol requests", async () => {
    const capability = mutation({
      handler: () => response(() => new Response("application response", {
        headers: { "content-type": "text/plain" },
        status: 409,
      })),
    });
    const result = await toResponse(capability, createContext(new Request(
      "https://example.test/posts",
      { headers: { [MUTATION_REQUEST_HEADER]: MUTATION_REQUEST_VALUE }, method: "POST" },
    )));

    expect(result.status).toBe(409);
    expect(result.headers.get("content-type")).toBe("text/plain");
    await expect(result.text()).resolves.toBe("application response");
  });

  it("returns a stable response for application validation errors", async () => {
    const capability = mutation({
      input: async () => {
        throw new MutationValidationError<"title">({
          issues: [{
            code: "required",
            message: "Title is required",
            path: ["title"],
          }],
        });
      },
      handler: () => new Response("unreachable"),
    });

    const response = await toResponse(
      capability,
      createContext(new Request("https://example.test/posts", { method: "POST" })),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      type: "validation-error",
      validation: {
        issues: [{ code: "required", message: "Title is required", path: ["title"] }],
      },
    });
  });

  it.each([
    ["undefined", { saved: undefined }],
    ["a function", { saved: () => true }],
    ["a bigint", { saved: 1n }],
    ["a non-finite number", { saved: Number.NaN }],
    ["a custom object", { saved: new Date(0) }],
  ])("rejects %s in a structured result", async (_name, data) => {
    const capability = mutation({ publicData: true, handler: () => json(data) });
    const context = createContext(new Request("https://example.test/posts", {
      headers: { [MUTATION_REQUEST_HEADER]: MUTATION_REQUEST_VALUE },
      method: "POST",
    }));

    await expect(toResponse(capability, context)).rejects.toThrow(
      "Route /posts could not serialize the field saved for the browser.",
    );
  });

  it("rejects a cyclic structured result", async () => {
    const data: { self?: unknown } = {};
    data.self = data;
    const capability = mutation({ publicData: true, handler: () => json(data) });
    const context = createContext(new Request("https://example.test/posts", {
      headers: { [MUTATION_REQUEST_HEADER]: MUTATION_REQUEST_VALUE },
      method: "POST",
    }));

    await expect(toResponse(capability, context)).rejects.toThrow(
      "Route /posts could not serialize the field self for the browser.",
    );
  });

  it("rejects an unsupported cache key in revalidation metadata", async () => {
    const capability = mutation({
      revalidate: { keys: [["post", Number.NaN]] },
      handler: () => new Response("committed"),
    });
    const context = createContext(
      new Request("https://example.test/posts", { method: "POST" }),
    );

    await expect(toResponse(capability, context)).rejects.toThrow(
      "A mutation result contains a value that JSON cannot serialize.",
    );
  });
  it("parses JSON input and returns response capabilities", async () => {
    const capability = mutation({
      publicData: true,
      input: mutationInput.json,
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

  it("supports form and text mutation inputs", async () => {
    const formCapability = mutation({
      publicData: true,
      input: mutationInput.formData,
      handler({ input }) {
        return json({
          title: input.get("title"),
        });
      },
    });
    const textCapability = mutation({
      input: mutationInput.text,
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

  it("validates and transforms form input with a Standard Schema", async () => {
    const schema: StandardSchemaV1<
      { title: FormDataEntryValue | null },
      { title: string }
    > = {
      "~standard": {
        version: 1 as const,
        vendor: "test",
        validate(value: unknown) {
          const title = value && typeof value === "object" && "title" in value
            ? value.title
            : undefined;
          if (typeof title !== "string" || !title.trim()) {
            return {
              issues: [{ message: "Enter a title.", path: ["title"] }],
            };
          }
          return { value: { title: title.trim() } };
        },
      },
    };
    const capability = mutation({
      publicData: true,
      input: mutationInput.form(schema, (form) => ({
        title: form.get("title"),
      })),
      handler: ({ input }) => json({ title: input.title }),
    });
    const typed: MutationCapability<{ title: string }, "title"> = capability;
    const form = new FormData();
    form.set("title", "  Hello  ");

    const result = await toResponse(
      typed,
      createContext(new Request("https://example.test/posts", {
        body: form,
        method: "POST",
      })),
    );

    await expect(result.json()).resolves.toEqual({ title: "Hello" });
  });

  it("normalizes Standard Schema issues for mutation results", async () => {
    const schema = {
      "~standard": {
        version: 1 as const,
        vendor: "test",
        validate: () => ({
          issues: [{
            message: "Enter a title.",
            path: [{ key: "title" }, { key: "value" }],
          }],
        }),
      },
    };
    const capability = mutation({
      input: mutationInput.form(schema, () => ({})),
      handler: () => new Response("unreachable"),
    });

    const result = await toResponse(
      capability,
      createContext(new Request("https://example.test/posts", {
        body: new FormData(),
        headers: { [MUTATION_REQUEST_HEADER]: MUTATION_REQUEST_VALUE },
        method: "POST",
      })),
    );

    await expect(result.json()).resolves.toMatchObject({
      status: "invalid",
      validation: {
        issues: [{
          code: "invalid",
          message: "Enter a title.",
          path: ["title", "value"],
        }],
      },
    });
  });

  it("replays idempotent mutation responses for matching keys", async () => {
    const store = createMemoryIdempotencyStore();
    const createPost = vi.fn(async () =>
      redirect(`/posts/${createPost.mock.calls.length}`, 303),
    );
    const capability = mutation({
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

  it("does not replay failed idempotent mutations", async () => {
    const store = createMemoryIdempotencyStore();
    const createPost = vi
      .fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(json({ ok: true }));
    const capability = mutation({
      publicData: true,
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
    const capability = mutation({
      revalidate: { tags: [{ id: "posts" }] },
      handler: () => new Response("ok"),
    });

    const response = await toResponse(
      capability,
      createContext(new Request("https://example.test/posts", { method: "POST" })),
    );

    expect(readRevalidation(response)).toEqual({
      keys: [],
      tags: ["posts"],
      version: 1,
    });
  });

  it("does not declare cache tags for a failed mutation", async () => {
    const revalidate = vi.fn(() => ({ tags: [{ id: "posts" }] } as const));
    const capability = mutation({
      revalidate,
      handler: () => new Response("failed", { status: 422 }),
    });

    const result = await toResponse(
      capability,
      createContext(new Request("https://example.test/posts", { method: "POST" })),
    );

    expect(result.headers.has("x-demiurge-revalidate-tags")).toBe(false);
    expect(revalidate).not.toHaveBeenCalled();
  });
});

function readRevalidation(response: Response) {
  const value = response.headers.get("x-demiurge-revalidate-tags");
  if (!value) return undefined;
  return JSON.parse(decodeURIComponent(value)) as unknown;
}
