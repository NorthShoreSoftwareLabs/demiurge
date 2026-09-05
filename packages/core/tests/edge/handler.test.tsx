import { describe, expect, it, vi } from "vitest";
import {
  createMemoryCacheStore,
  createMemoryRateLimitStore,
  defineRoutePolicy,
  json,
  page,
  text,
  type RouteModule,
  type RouteProps,
} from "@demiurgejs/core";
import {
  createEdgeRequestHandler,
  EdgeSharedStoreError,
} from "@demiurgejs/core/edge";

function routeModule(module: RouteModule) {
  return vi.fn(async () => module);
}

function Home({ data }: RouteProps<string, { message: string }>) {
  return <main>{data.message}</main>;
}

const origin = "https://edge.handler.test";

const cachedRoutes = {
  "./routes/index.tsx": routeModule({
    GET: page<string, { message: string }>({
      publicData: true,
      data: async ({ cache }) => ({
        message: await cache.get({
          fn: () => "cached message",
          key: ["message"],
          scope: "public",
        }),
      }),
      view: Home,
    }),
  }),
};

const rateLimitedModules = {
  "./routes/limited.ts": {
    GET: text("limited", {
      security: { rateLimit: { key: "ip", limit: 1, window: "1m" } },
    }),
  },
} satisfies Record<string, RouteModule>;

describe("createEdgeRequestHandler", () => {
  it("refuses construction without a cache store decision", () => {
    expect(() =>
      createEdgeRequestHandler({
        rateLimitStore: "unavailable",
        routes: {},
      } as never),
    ).toThrow(/edge cacheStore is required/);
  });

  it("refuses construction without a rate limit store decision", () => {
    expect(() =>
      createEdgeRequestHandler({
        cacheStore: "unavailable",
        routes: {},
      } as never),
    ).toThrow(/edge rateLimitStore is required/);
  });

  it("refuses a rate limit policy when no shared store exists", () => {
    expect(() =>
      createEdgeRequestHandler({
        cacheStore: "unavailable",
        rateLimitStore: "unavailable",
        routeModules: rateLimitedModules,
        routes: {
          "./routes/limited.ts": routeModule(rateLimitedModules["./routes/limited.ts"]),
        },
      }),
    ).toThrow(/declares a rate limit policy/);
  });

  it("refuses a rate limit policy declared on a route policy file", () => {
    const modules = {
      "./routes/@policy.ts": defineRoutePolicyModule(),
    } satisfies Record<string, RouteModule>;

    expect(() =>
      createEdgeRequestHandler({
        cacheStore: "unavailable",
        rateLimitStore: "unavailable",
        routeModules: modules,
        routes: { "./routes/@policy.ts": routeModule(modules["./routes/@policy.ts"]) },
      }),
    ).toThrow(/declares a rate limit policy/);
  });

  it("fails a shared cache scope instead of caching per isolate", async () => {
    const handler = createEdgeRequestHandler({
      cacheStore: "unavailable",
      onError: () => {},
      rateLimitStore: "unavailable",
      routes: cachedRoutes,
    });
    const response = await handler(new Request(`${origin}/`));

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("cached message");
  });

  it("serves a shared cache scope when a store is configured", async () => {
    const handler = createEdgeRequestHandler({
      cacheStore: {
        namespace: { app: "edge", environment: "test", schemaVersion: 1 },
        store: createMemoryCacheStore(),
      },
      rateLimitStore: "unavailable",
      routes: cachedRoutes,
    });
    const response = await handler(new Request(`${origin}/`));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("cached message");
  });

  it("enforces a rate limit with the client address the host reports", async () => {
    const handler = createEdgeRequestHandler({
      cacheStore: "unavailable",
      clientIp: (request) => request.headers.get("x-real-ip"),
      rateLimitStore: createMemoryRateLimitStore(),
      routeModules: rateLimitedModules,
      routes: {
        "./routes/limited.ts": routeModule(rateLimitedModules["./routes/limited.ts"]),
      },
    });
    const first = await handler(
      new Request(`${origin}/limited`, { headers: { "x-real-ip": "203.0.113.7" } }),
    );
    const second = await handler(
      new Request(`${origin}/limited`, { headers: { "x-real-ip": "203.0.113.7" } }),
    );
    const other = await handler(
      new Request(`${origin}/limited`, { headers: { "x-real-ip": "203.0.113.9" } }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(other.status).toBe(200);
  });

  it("serves a bundled asset before the route pipeline", async () => {
    const handler = createEdgeRequestHandler({
      assets: { assets: { "/assets/app-abcdef12.js": { body: "export {};\n" } } },
      cacheStore: "unavailable",
      rateLimitStore: "unavailable",
      routes: {
        "./routes/index.tsx": routeModule({ GET: json({ route: true }) }),
      },
    });
    const asset = await handler(new Request(`${origin}/assets/app-abcdef12.js`));
    const route = await handler(new Request(`${origin}/`));

    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(route.status).toBe(200);
    expect(await route.json()).toEqual({ route: true });
  });

  it("accepts an asset handler the application builds itself", async () => {
    const handler = createEdgeRequestHandler({
      assets: async (request) =>
        new URL(request.url).pathname === "/owned.txt"
          ? new Response("owned")
          : null,
      cacheStore: "unavailable",
      rateLimitStore: "unavailable",
      routes: {},
    });

    expect(await (await handler(new Request(`${origin}/owned.txt`))).text())
      .toBe("owned");
  });
});

describe("EdgeSharedStoreError", () => {
  it("names the option that resolves it", () => {
    const error = new EdgeSharedStoreError("Demiurge edge test message.");

    expect(error.name).toBe("EdgeSharedStoreError");
    expect(error).toBeInstanceOf(Error);
  });
});

function defineRoutePolicyModule(): RouteModule {
  return {
    policy: defineRoutePolicy({
      security: { rateLimit: { key: "ip", limit: 1, window: "1m" } },
    }),
  };
}
