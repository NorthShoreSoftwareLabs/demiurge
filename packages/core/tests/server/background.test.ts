import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createRequestHandler, defineAdapter, page, response, type HttpRouteContext, type RuntimeSpanStartOptions } from "@demiurgejs/core";
import { createEdgeRequestHandler, EDGE_SHARED_STORE_UNAVAILABLE } from "@demiurgejs/core/edge";
import { createNodeServer, nodeAdapter } from "@demiurgejs/core/node";

function routes(run: (context: HttpRouteContext) => Response) {
  return { "./routes/index.ts": async () => ({
    policy: { access: { public: true } },
    GET: response(run),
  }) };
}

const request = () => new Request("http://localhost/");

describe("request background work", () => {
  it("rejects unsupported adapters before tasks start", () => {
    const background = { onError: vi.fn(), waitUntil: vi.fn() };
    expect(() => createRequestHandler({ background, routes: {} })).toThrow("backgroundLifetime");
    expect(() => createRequestHandler({ adapter: defineAdapter({ name: "unsupported" }), background, routes: {} })).toThrow("backgroundLifetime");
    expect(() => createEdgeRequestHandler({ background, routes: {}, cacheStore: EDGE_SHARED_STORE_UNAVAILABLE, rateLimitStore: EDGE_SHARED_STORE_UNAVAILABLE })).toThrow("backgroundLifetime");
    expect(background.waitUntil).not.toHaveBeenCalled();
  });

  it("validates the lifetime and error callbacks at startup", () => {
    const background = JSON.parse('{"onError":null,"waitUntil":null}');
    expect(() => createRequestHandler({ adapter: nodeAdapter, background, routes: {} })).toThrow("waitUntil and onError");
  });

  it("shares background work with middleware and page data", async () => {
    const task = vi.fn();
    const promises: Promise<void>[] = [];
    const handler = createRequestHandler({
      adapter: nodeAdapter,
      background: { onError: vi.fn(), waitUntil: (work) => { promises.push(work); } },
      routes: { "./routes/@middleware.ts": async () => ({
        middleware: (context, next) => {
          context.background?.run(task);
          return next();
        },
      }), "./routes/index.tsx": async () => ({
        policy: { access: { public: true } },
        GET: page({ data: ({ background }) => { background?.run(task); return "ready"; }, view: () => null }),
      }) },
    });
    expect((await handler(request())).status).toBe(200);
    await Promise.all(promises);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("links a separate background span to its scheduling request", async () => {
    const startSpan = vi.fn((options: RuntimeSpanStartOptions) => ({
      context: { operation: options.operation },
      end: vi.fn(),
      addEvent: vi.fn(),
      setName: vi.fn(),
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
    }));
    const work: Promise<void>[] = [];
    const handler = createRequestHandler({
      adapter: nodeAdapter,
      runtimeInstrumentation: { startSpan },
      background: { onError: vi.fn(), waitUntil: (pending) => { work.push(pending); } },
      routes: routes(({ background }) => {
        background?.run(() => undefined);
        return new Response("ready");
      }),
    });
    await (await handler(request())).text();
    await Promise.all(work);
    const spanOptions = startSpan.mock.calls.map(([options]) => options).find((options) => options.operation === "demiurge.background");
    expect(spanOptions).toMatchObject({ kind: "internal", links: [{ context: { operation: "demiurge.request" } }] });
    expect(spanOptions?.parent).toBeUndefined();
  });

  it("does not start a task when lifetime registration fails", async () => {
    const task = vi.fn();
    const handler = createRequestHandler({
      adapter: nodeAdapter,
      background: { onError: vi.fn(), waitUntil() { throw new Error("registration failed"); } },
      routes: routes(({ background }) => {
        expect(() => background?.run(task)).toThrow("registration failed");
        return new Response("ready");
      }),
    });
    expect((await handler(request())).status).toBe(200);
    await Promise.resolve();
    expect(task).not.toHaveBeenCalled();
  });

  it("reports synchronous and asynchronous failures without changing responses", async () => {
    const promises: Promise<void>[] = [];
    const errors = [new Error("sync"), new Error("async")];
    const onError = vi.fn(async () => { throw new Error("report failure"); });
    let escaped: HttpRouteContext["background"];
    const handler = createRequestHandler({
      adapter: nodeAdapter,
      background: { onError, waitUntil: (work) => { promises.push(work); } },
      routes: routes(({ background }) => {
        escaped = background;
        background?.run(() => { throw errors[0]; });
        background?.run(async () => { throw errors[1]; });
        return new Response("ready");
      }),
    });
    expect(await (await handler(request())).text()).toBe("ready");
    await Promise.all(promises);
    expect(onError.mock.calls).toEqual([[errors[0]], [errors[1]]]);
    const task = vi.fn();
    expect(() => escaped?.run(task)).toThrow("after the response");
    expect(task).not.toHaveBeenCalled();
  });

  it("returns a response while Node shutdown waits for its registered task", async () => {
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const server = createNodeServer({ allowedHosts: ["127.0.0.1"], handler: (incoming) => handler(incoming) });
    const handler = createRequestHandler({
      adapter: nodeAdapter,
      background: { onError: vi.fn(), waitUntil: (work) => server.waitUntil(work) },
      routes: routes(({ background }) => {
        background?.run(() => pending);
        return new Response("ready");
      }),
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing TCP address.");
    expect(await (await fetch(`http://127.0.0.1:${address.port}/`)).text()).toBe("ready");
    let stopped = false;
    const shutdown = server.shutdown().then(() => { stopped = true; });
    await new Promise((resolve) => setImmediate(resolve));
    expect(stopped).toBe(false);
    finish?.();
    await shutdown;
    expect(stopped).toBe(true);
  });
});
