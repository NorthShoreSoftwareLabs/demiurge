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
function rawRequest(port: number, method: string) {
  return new Promise<{ status: number | undefined }>((resolveRequest, rejectRequest) => {
    const req = httpRequest(
      { host: "127.0.0.1", method, port },
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
      server.close();
      await once(server, "close").catch(() => undefined);
      await rm(root, { force: true, recursive: true });
    }
  });

  it("accepts a custom static file handler", async () => {
    const handler = vi.fn(async () => new Response("route"));
    const staticHandler = vi.fn(async () => new Response("custom asset"));
    const server = createNodeServer({ handler, static: staticHandler });

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
      server.close();
      await once(server, "close").catch(() => undefined);
    }
  });

  it("falls through to the Web Request handler and exposes capabilities", async () => {
    const server = createNodeServer({
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
      server.close();
      await once(server, "close").catch(() => undefined);
    }
  });

  it("returns a generic 500 when the handler throws", async () => {
    const server = createNodeServer({
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
      server.close();
      await once(server, "close").catch(() => undefined);
    }
  });

  it("responds 501 to forbidden methods instead of a generic 500", async () => {
    const onError = vi.fn();
    const server = createNodeServer({
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
      server.close();
      await once(server, "close").catch(() => undefined);
    }
  });

  // A cancelled download is ordinary traffic. Routing it through onError would
  // log a stack trace per abandoned image, and any unauthenticated client can
  // trigger that at will — the same log-flood the 501 guard above prevents.
  it("does not report a client hanging up mid-response as a server error", async () => {
    const onError = vi.fn();
    const server = createNodeServer({
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
      server.close();
      server.closeAllConnections();
      await once(server, "close").catch(() => undefined);
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
    const server = createNodeServer({ handler });

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
      server.close();
      await once(server, "close").catch(() => undefined);
    }
  });
});
