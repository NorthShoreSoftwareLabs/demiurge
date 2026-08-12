import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { request as httpRequest, type Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  assertAdapterCapabilities,
  createRequestHandler,
  defineRoutePolicy,
  page,
  security,
  type RouteModule,
  type RouteProps,
} from "demiurge";
import { createNodeServer, nodeAdapter } from "demiurge/node";

function routeModule(module: RouteModule) {
  return vi.fn(async () => module);
}

function HomePage({ data }: RouteProps<"/", { message: string }>) {
  return <main data-testid="home">{data.message}</main>;
}

// `fetch` itself refuses to construct a forbidden-method request client-side,
// so exercising the server's own guard needs the lower-level `http.request`,
// which has no such restriction.
function rawRequest(
  port: number,
  method: string,
  headers?: Record<string, string>,
) {
  return new Promise<{ status: number | undefined }>((resolveRequest, rejectRequest) => {
    const req = httpRequest(
      { headers, host: "127.0.0.1", method, port },
      (response) => {
        response.resume();
        response.on("end", () => resolveRequest({ status: response.statusCode }));
      },
    );

    req.on("error", rejectRequest);
    req.end();
  });
}

function connectionCount(server: Server) {
  return new Promise<number>((resolveCount) => {
    server.getConnections((_error, count) => resolveCount(count));
  });
}

describe("Node adapter", () => {
  it("serves static files before the route handler", async () => {
    const root = mkdtempSync(join(tmpdir(), "demiurge-node-server-"));
    writeFileSync(join(root, "app.js"), "console.log('ok');");
    const server = createNodeServer({
      allowedHosts: ["127.0.0.1"],
      handler: async () => new Response("route"),
      static: { root },
    });

    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const response = await fetch(`http://127.0.0.1:${port}/app.js`);

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("console.log('ok');");
    } finally {
      await server.shutdown();
      await rm(root, { force: true, recursive: true });
    }
  });

  it("accepts a custom static file handler", async () => {
    const handler = vi.fn(async () => new Response("route"));
    const staticHandler = vi.fn(async () => new Response("custom asset"));
    const server = createNodeServer({
      allowedHosts: ["127.0.0.1"],
      handler,
      static: staticHandler,
    });

    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const response = await fetch(`http://127.0.0.1:${port}/app.js`);

      await expect(response.text()).resolves.toBe("custom asset");
      expect(staticHandler).toHaveBeenCalledOnce();
      expect(handler).not.toHaveBeenCalled();
    } finally {
      await server.shutdown();
    }
  });

  it("falls through to the Web Request handler and exposes capabilities", async () => {
    const server = createNodeServer({
      allowedHosts: ["127.0.0.1"],
      handler: async (request) =>
        new Response(
          JSON.stringify({ pathname: new URL(request.url).pathname }),
          { headers: { "content-type": "application/json" } },
        ),
    });

    assertAdapterCapabilities(nodeAdapter, ["streaming", "nonceInjection"]);

    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);

      await expect(response.json()).resolves.toEqual({ pathname: "/api/health" });
    } finally {
      await server.shutdown();
    }
  });

  it("returns a generic 500 when the handler throws", async () => {
    const server = createNodeServer({
      allowedHosts: ["127.0.0.1"],
      handler: async () => {
        throw new Error("secret stack detail");
      },
    });

    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const response = await fetch(`http://127.0.0.1:${port}/failure`);

      expect(response.status).toBe(500);
      await expect(response.text()).resolves.toBe("Internal Server Error");
    } finally {
      await server.shutdown();
    }
  });

  it("responds 501 to forbidden methods instead of a generic 500", async () => {
    const onError = vi.fn();
    const server = createNodeServer({
      allowedHosts: ["127.0.0.1"],
      handler: async () => new Response("route"),
      onError,
    });

    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const response = await rawRequest(port, "TRACE");

      expect(response.status).toBe(501);
      expect(onError).not.toHaveBeenCalled();
    } finally {
      await server.shutdown();
    }
  });

  it("rejects an unrecognized Host before calling the request handler", async () => {
    const handler = vi.fn(async () => new Response("route"));
    const server = createNodeServer({
      allowedHosts: ["example.test"],
      handler,
    });

    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const response = await rawRequest(port, "GET", { host: "evil.example" });

      expect(response.status).toBe(421);
      expect(handler).not.toHaveBeenCalled();
    } finally {
      await server.shutdown();
    }
  });

  it("applies typed production timeout defaults and validates overrides", () => {
    const server = createNodeServer({
      allowedHosts: ["localhost"],
      handler: async () => new Response("ok"),
    });
    const configured = createNodeServer({
      allowedHosts: ["localhost"],
      handler: async () => new Response("ok"),
      timeouts: {
        headersTimeout: 81_000,
        keepAliveTimeout: 80_000,
        requestTimeout: 120_000,
      },
    });

    expect(server.keepAliveTimeout).toBe(65_000);
    expect(server.headersTimeout).toBe(66_000);
    expect(server.requestTimeout).toBe(300_000);
    expect(configured.keepAliveTimeout).toBe(80_000);
    expect(configured.headersTimeout).toBe(81_000);
    expect(configured.requestTimeout).toBe(120_000);
    expect(() =>
      createNodeServer({
        allowedHosts: ["localhost"],
        handler: async () => new Response("ok"),
        timeouts: { keepAliveTimeout: 0 },
      }),
    ).toThrow("keepAliveTimeout must be a positive integer");
    expect(() =>
      createNodeServer({
        allowedHosts: ["localhost"],
        handler: async () => new Response("ok"),
        timeouts: { headersTimeout: 60_000 },
      }),
    ).toThrow("headersTimeout must be greater than keepAliveTimeout");
  });

  it("marks readiness false and drains an active request before shutdown", async () => {
    const response = deferred<Response>();
    const started = deferred<void>();
    const states: string[] = [];
    const server = createNodeServer({
      allowedHosts: ["127.0.0.1"],
      handler: async () => {
        started.resolve();
        return await response.promise;
      },
      shutdown: {
        gracePeriod: 1_000,
        onStateChange: (state) => states.push(state),
      },
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const pendingFetch = fetch(`http://127.0.0.1:${port}/slow`);
    await started.promise;

    expect(server.isReady()).toBe(true);
    const shutdown = server.shutdown();
    expect(server.isReady()).toBe(false);
    response.resolve(new Response("complete"));

    await expect((await pendingFetch).text()).resolves.toBe("complete");
    await expect(shutdown).resolves.toBeUndefined();
    expect(states).toEqual(["ready", "draining", "stopped"]);
  });

  it("forces active connections closed when the shutdown deadline expires", async () => {
    const started = deferred<void>();
    const server = createNodeServer({
      allowedHosts: ["127.0.0.1"],
      handler: async () => {
        started.resolve();
        return await new Promise<Response>(() => undefined);
      },
      shutdown: { gracePeriod: 5 },
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const pendingFetch = fetch(`http://127.0.0.1:${port}/never`).catch(
      () => undefined,
    );
    await started.promise;

    await expect(server.shutdown()).resolves.toBeUndefined();
    await pendingFetch;
    expect(server.isReady()).toBe(false);
  });

  it("aborts route work exactly once when the client disconnects", async () => {
    const started = deferred<void>();
    const aborted = deferred<void>();
    let abortCount = 0;
    const server = createNodeServer({
      allowedHosts: ["127.0.0.1"],
      handler: (request) =>
        new Promise<Response>((resolveResponse) => {
          request.signal.addEventListener(
            "abort",
            () => {
              abortCount += 1;
              aborted.resolve();
              resolveResponse(new Response("aborted"));
            },
            { once: true },
          );
          started.resolve();
        }),
    });

    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const request = httpRequest({ host: "127.0.0.1", path: "/slow", port });
      request.on("error", () => undefined);
      request.end();
      await started.promise;
      request.destroy();

      await aborted.promise;
      await new Promise((resolveTick) => setImmediate(resolveTick));
      expect(abortCount).toBe(1);
    } finally {
      await server.shutdown();
    }
  });

  // A cancelled download is ordinary traffic. Routing it through onError would
  // log a stack trace per abandoned image, and any unauthenticated client can
  // trigger that at will — the same log-flood the 501 guard above prevents.
  it("does not report a client hanging up mid-response as a server error", async () => {
    const onError = vi.fn();
    const server = createNodeServer({
      allowedHosts: ["127.0.0.1"],
      onError,
      handler: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("x".repeat(1024)));
              // Never closed: the client aborts part-way through.
            },
          }),
          { headers: { "content-type": "text/plain; charset=utf-8" } },
        ),
    });

    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;

      await new Promise<void>((resolveAbort) => {
        const req = httpRequest(
          { host: "127.0.0.1", path: "/stream", port },
          (response) => {
            response.once("data", () => {
              req.destroy();
              resolveAbort();
            });
          },
        );

        req.on("error", () => undefined);
        req.end();
      });

      // The write fails as the socket closes, so wait for the connection to
      // drop and then let the rejection settle rather than sleeping blind.
      await vi.waitFor(async () => {
        expect(await connectionCount(server)).toBe(0);
      });
      await new Promise((resolveTick) => setImmediate(resolveTick));

      expect(onError).not.toHaveBeenCalled();
    } finally {
      await server.shutdown();
    }
  });

  // This is the seam where the production route glob once silently dropped
  // `.ts` files (`@policy.ts`, `@middleware.ts`): every other test in this
  // suite uses a stub handler, so nothing exercised `createRequestHandler`
  // against real route modules through an actual Node server. This test
  // boots the real production stack — createNodeServer, createRequestHandler,
  // a page route, and an inherited @policy.ts — the way examples/node-server
  // does, and checks the three things that policy is supposed to guarantee:
  // server-rendered markup, the stylesheet link, and the CSP header.
  it("serves a real page route through the full production stack with its inherited policy applied", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/@policy.ts": routeModule({
          policy: defineRoutePolicy({
            document: security.strict(),
          }),
        }),
        "./routes/index.tsx": routeModule({
          GET: page({
            data: () => ({ message: "SSR is running" }),
            view: HomePage,
          }),
        }),
      },
      ssr: {
        clientEntry: "/assets/client-entry.js",
        styles: ["/assets/client-entry.css"],
      },
    });
    const server = createNodeServer({
      allowedHosts: ["127.0.0.1"],
      handler,
    });

    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const response = await fetch(`http://127.0.0.1:${port}/`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain('data-testid="home"');
      expect(html).toContain("SSR is running");
      expect(html).toContain(
        '<link rel="stylesheet" href="/assets/client-entry.css" />',
      );

      const csp = response.headers.get("content-security-policy");

      expect(csp).toMatch(/script-src 'nonce-[^']+' 'strict-dynamic'/);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    } finally {
      await server.shutdown();
    }
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}
