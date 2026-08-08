import { describe, expect, it } from "vitest";
import {
  html,
  json,
  jsonl,
  notFound,
  redirect,
  response,
  serverTiming,
  sse,
  text,
  toResponse,
  type HttpRouteContext,
} from "demiurge";

const context: HttpRouteContext = {
  path: {},
  pathname: "/api/health",
  request: new Request("https://example.test/api/health"),
  search: new URLSearchParams(),
  url: new URL("https://example.test/api/health"),
};

describe("response helpers", () => {
  it("creates JSON responses", async () => {
    const result = await toResponse(json({ ok: true }), context);

    expect(result.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    await expect(result.json()).resolves.toEqual({ ok: true });
  });

  it("creates JSON Lines streams", async () => {
    const result = await toResponse(
      jsonl([
        { id: 1, title: "First" },
        "plain",
        null,
      ]),
      context,
    );

    expect(result.headers.get("content-type")).toBe(
      "application/x-ndjson; charset=utf-8",
    );
    expect(result.headers.get("cache-control")).toBe("no-cache");
    expect(result.headers.get("x-accel-buffering")).toBe("no");
    await expect(result.text()).resolves.toBe(
      '{"id":1,"title":"First"}\n"plain"\nnull\n',
    );
  });

  it("creates text responses", async () => {
    const result = await toResponse(text("hello"), context);

    expect(result.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    await expect(result.text()).resolves.toBe("hello");
  });

  it("creates HTML responses", async () => {
    const result = await toResponse(html("<h1>Hello</h1>"), context);

    expect(result.headers.get("content-type")).toBe("text/html; charset=utf-8");
    await expect(result.text()).resolves.toBe("<h1>Hello</h1>");
  });

  it("creates redirect responses", async () => {
    const result = await toResponse(redirect("/login"), context);

    expect(result.status).toBe(302);
    expect(result.headers.get("location")).toBe("/login");
  });

  it("creates redirects from typed URL targets", async () => {
    const result = await toResponse(
      redirect({ to: "/blog/[slug]", path: { slug: "hello world" } }),
      context,
    );

    expect(result.headers.get("location")).toBe("/blog/hello%20world");
  });

  it("creates not-found responses", async () => {
    const result = await toResponse(notFound("missing"), context);

    expect(result.status).toBe(404);
    await expect(result.text()).resolves.toBe("missing");
  });

  it("preserves raw responses", async () => {
    const raw = new Response("custom", {
      headers: {
        "x-demo": "yes",
      },
      status: 201,
    });

    const result = await toResponse(response(raw), context);

    expect(result.status).toBe(201);
    expect(result.headers.get("x-demo")).toBe("yes");
    await expect(result.text()).resolves.toBe("custom");
  });

  it("resolves context-aware response values", async () => {
    const result = await toResponse(
      json(({ pathname }) => ({ pathname })),
      context,
    );

    await expect(result.json()).resolves.toEqual({ pathname: "/api/health" });
  });

  it("attaches route-owned server timing metadata", () => {
    const capability = json(
      { ok: true },
      {
        timing: serverTiming(
          { duration: 12.5, name: "db", description: "database query" },
          { name: "cache" },
        ),
      },
    );

    expect(capability.timing).toEqual([
      { duration: 12.5, name: "db", description: "database query" },
      { name: "cache" },
    ]);
    expect(capability.init).not.toHaveProperty("timing");
  });

  it("creates server-sent event streams", async () => {
    const result = await toResponse(
      sse([
        "ready",
        {
          data: { ok: true },
          event: "message",
          id: "evt-1",
          retry: 1000,
        },
        {
          comment: "keep alive",
        },
      ]),
      context,
    );

    expect(result.headers.get("content-type")).toBe(
      "text/event-stream; charset=utf-8",
    );
    expect(result.headers.get("cache-control")).toBe("no-cache");
    expect(result.headers.get("x-accel-buffering")).toBe("no");
    await expect(result.text()).resolves.toBe([
      "data: ready",
      "",
      'id: evt-1',
      "event: message",
      "retry: 1000",
      'data: {"ok":true}',
      "",
      ": keep alive",
      "",
      "",
    ].join("\n"));
  });

  it("rejects invalid server-sent event retry values", async () => {
    const result = await toResponse(sse([{ retry: -1 }]), context);

    await expect(result.text()).rejects.toThrow(
      "SSE retry must be a non-negative integer.",
    );
  });
});
