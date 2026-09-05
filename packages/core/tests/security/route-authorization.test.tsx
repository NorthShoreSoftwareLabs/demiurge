import { describe, expect, it, vi } from "vitest";
import {
  authorizeRoute,
  createMemoryCacheStore,
  createRequestHandler,
  createSecurityAudit,
  defineAuthorization,
  defineMiddleware,
  defineRoutePolicy,
  json,
  mergeRoutePolicies,
  mutation,
  page,
  resolveRouteAccess,
  type RouteModule,
  type RouteProps,
} from "@demiurgejs/core";

type Principal = {
  id: string;
  tenant: string;
};

type AuthContext = {
  principal?: Principal;
};

const namespace = {
  app: "route-authorization-test",
  environment: "test",
  schemaVersion: 1,
} as const;

// The example application reads the person from a header. A real application
// reads a session.
const session = defineMiddleware<AuthContext>(({ context, request }, next) => {
  const id = request.headers.get("x-user");
  const tenant = request.headers.get("x-tenant");

  if (id && tenant) {
    context.principal = { id, tenant };
  }

  return next();
});

function routeModule(module: RouteModule) {
  return async () => module;
}

function requestFor(url: string, principal?: Principal, init?: RequestInit) {
  const headers = new Headers(init?.headers);

  if (principal) {
    headers.set("x-user", principal.id);
    headers.set("x-tenant", principal.tenant);
  }

  return new Request(url, { ...init, headers });
}

// The hook denies when the request carries no authentication context, because
// `context.principal` is then undefined.
const requiresSignIn = defineAuthorization<AuthContext>(
  ({ context }) => Boolean(context.principal),
);

function View({ data }: RouteProps<string, { record: string }>) {
  return <main>{data.record}</main>;
}

describe("route authorization in the shared request pipeline", () => {
  it("runs authorization before the effect of a direct mutation request", async () => {
    const effect = vi.fn(() => json({ saved: true }));
    const handler = createRequestHandler({
      routes: {
        "./routes/@middleware.ts": async () => ({ middleware: session }),
        "./routes/@policy.ts": async () => ({
          policy: defineRoutePolicy({ access: { authorize: requiresSignIn } }),
        }),
        "./routes/posts.ts": routeModule({
          POST: mutation({ handler: effect }),
        }),
      },
    });

    const response = await handler(
      requestFor("https://example.test/posts", undefined, { method: "POST" }),
    );

    expect(response.status).toBe(403);
    // The effect is the assertion. A status code alone does not prove that the
    // mutation changed nothing.
    expect(effect).not.toHaveBeenCalled();
  });

  it("rejects a request for the record of another person", async () => {
    const owns = defineAuthorization<AuthContext>(
      ({ context, path }) => context.principal?.id === path.id,
    );
    const load = vi.fn(() => json({ record: "account" }));
    const handler = createRequestHandler({
      routes: {
        "./routes/@middleware.ts": async () => ({ middleware: session }),
        "./routes/accounts/@policy.ts": async () => ({
          policy: defineRoutePolicy({ access: { authorize: owns } }),
        }),
        "./routes/accounts/[id].ts": routeModule({ GET: json(load) }),
      },
    });
    const person = { id: "user-1", tenant: "tenant-1" };

    const permitted = await handler(
      requestFor("https://example.test/accounts/user-1", person),
    );
    const denied = await handler(
      requestFor("https://example.test/accounts/user-2", person),
    );

    expect(permitted.status).toBe(200);
    expect(denied.status).toBe(403);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("rejects a request for the record of another tenant", async () => {
    const sameTenant = defineAuthorization<AuthContext>(
      ({ context, path }) => context.principal?.tenant === path.tenant,
    );
    const load = vi.fn(() => json({ record: "report" }));
    const handler = createRequestHandler({
      routes: {
        "./routes/@middleware.ts": async () => ({ middleware: session }),
        "./routes/tenants/@policy.ts": async () => ({
          policy: defineRoutePolicy({ access: { authorize: sameTenant } }),
        }),
        "./routes/tenants/[tenant]/reports.ts": routeModule({
          GET: json(load),
        }),
      },
    });
    const person = { id: "user-1", tenant: "tenant-1" };

    const permitted = await handler(
      requestFor("https://example.test/tenants/tenant-1/reports", person),
    );
    const denied = await handler(
      requestFor("https://example.test/tenants/tenant-2/reports", person),
    );

    expect(permitted.status).toBe(200);
    expect(denied.status).toBe(403);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("gives a navigation data request the same answer as a document request", async () => {
    const routes = {
      "./routes/@middleware.ts": async () => ({ middleware: session }),
      "./routes/@policy.ts": async () => ({
        policy: defineRoutePolicy({ access: { authorize: requiresSignIn } }),
      }),
      "./routes/dashboard.tsx": routeModule({
        GET: page<string, { record: string }>({
          data: () => ({ record: "protected record" }),
          view: View,
        }),
      }),
    };
    const handler = createRequestHandler({ routes });
    const person = { id: "user-1", tenant: "tenant-1" };
    const navigation = { "x-demiurge-navigation": "data" };

    const document = await handler(
      requestFor("https://example.test/dashboard", person),
    );
    const data = await handler(
      requestFor("https://example.test/dashboard", person, {
        headers: navigation,
      }),
    );
    const deniedDocument = await handler(
      requestFor("https://example.test/dashboard"),
    );
    const deniedData = await handler(
      requestFor("https://example.test/dashboard", undefined, {
        headers: navigation,
      }),
    );

    expect(document.status).toBe(200);
    expect(data.status).toBe(200);
    expect(deniedDocument.status).toBe(deniedData.status);
    expect(deniedDocument.status).toBe(403);
    await expect(deniedData.text()).resolves.not.toContain("protected record");
  });

  it("keeps protected cached data out of a denied response", async () => {
    const load = vi.fn(() => ({ record: "protected record" }));
    const routes = {
      "./routes/@middleware.ts": async () => ({ middleware: session }),
      "./routes/@policy.ts": async () => ({
        policy: defineRoutePolicy({ access: { authorize: requiresSignIn } }),
      }),
      "./routes/reports.tsx": routeModule({
        GET: page<string, { record: string }>({
          data: ({ cache }) =>
            cache.get({ fn: load, key: ["report"], scope: "public" }),
          view: View,
        }),
      }),
    };
    const store = createMemoryCacheStore();
    const handler = createRequestHandler({
      cacheStore: { namespace, store },
      routes,
    });

    const permitted = await handler(
      requestFor("https://example.test/reports", {
        id: "user-1",
        tenant: "tenant-1",
      }),
    );
    const denied = await handler(requestFor("https://example.test/reports"));

    await expect(permitted.text()).resolves.toContain("protected record");
    expect(denied.status).toBe(403);
    await expect(denied.text()).resolves.not.toContain("protected record");
    // The denied request never reached the loader, so it never read the cache
    // entry that the permitted request wrote.
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("denies the request when the authorization hook throws", async () => {
    const load = vi.fn(() => json({ record: "account" }));
    const handler = createRequestHandler({
      routes: {
        "./routes/@policy.ts": async () => ({
          policy: defineRoutePolicy({
            access: {
              authorize: () => {
                throw new Error("the identity provider is unavailable");
              },
            },
          }),
        }),
        "./routes/reports.ts": routeModule({ GET: json(load) }),
      },
    });

    const response = await handler(new Request("https://example.test/reports"));

    expect(response.status).toBe(403);
    expect(load).not.toHaveBeenCalled();
  });

  it("denies the request when the authentication context is absent", async () => {
    const load = vi.fn(() => json({ record: "account" }));
    const handler = createRequestHandler({
      routes: {
        "./routes/@middleware.ts": async () => ({ middleware: session }),
        "./routes/@policy.ts": async () => ({
          policy: defineRoutePolicy({ access: { authorize: requiresSignIn } }),
        }),
        "./routes/reports.ts": routeModule({ GET: json(load) }),
      },
    });

    const response = await handler(requestFor("https://example.test/reports"));

    expect(response.status).toBe(403);
    expect(load).not.toHaveBeenCalled();
  });

  it("denies the request when a child declaration adds a restriction", async () => {
    const load = vi.fn(() => json({ record: "settings" }));
    const handler = createRequestHandler({
      routes: {
        "./routes/@middleware.ts": async () => ({ middleware: session }),
        "./routes/@policy.ts": async () => ({
          policy: defineRoutePolicy({ access: { authorize: requiresSignIn } }),
        }),
        "./routes/admin/@policy.ts": async () => ({
          policy: defineRoutePolicy({
            access: {
              authorize: defineAuthorization<AuthContext>(
                ({ context }) => context.principal?.id === "operator",
              ),
            },
          }),
        }),
        "./routes/admin/settings.ts": routeModule({ GET: json(load) }),
      },
    });

    const response = await handler(
      requestFor("https://example.test/admin/settings", {
        id: "user-1",
        tenant: "tenant-1",
      }),
    );

    expect(response.status).toBe(403);
    expect(load).not.toHaveBeenCalled();
  });

  it("denies a route that inherits no access declaration", async () => {
    const load = vi.fn(() => json({ record: "account" }));
    const handler = createRequestHandler({
      routes: {
        "./routes/reports.ts": routeModule({ GET: json(load) }),
      },
    });

    const response = await handler(new Request("https://example.test/reports"));

    expect(response.status).toBe(403);
    expect(load).not.toHaveBeenCalled();
  });

  it("serves a route that declares public access", async () => {
    const handler = createRequestHandler({
      routes: {
        "./routes/@policy.ts": async () => ({
          policy: defineRoutePolicy({ access: { public: true } }),
        }),
        "./routes/about.ts": routeModule({ GET: json({ ok: true }) }),
      },
    });

    const response = await handler(new Request("https://example.test/about"));

    expect(response.status).toBe(200);
  });
});

describe("the route access cascade", () => {
  const parent = defineAuthorization(() => true);
  const child = defineAuthorization(() => false);

  it("accumulates each inherited hook in root order", () => {
    const access = resolveRouteAccess([
      { policy: { authorize: parent }, source: "routes/@policy.ts" },
      { policy: { authorize: child }, source: "routes/admin/@policy.ts" },
    ]);

    expect(access.chain.map((entry) => entry.source)).toEqual([
      "routes/@policy.ts",
      "routes/admin/@policy.ts",
    ]);
    expect(access.declared).toBe(true);
    expect(access.public).toBe(false);
  });

  it("keeps an inherited hook when a child declares public access", () => {
    const access = resolveRouteAccess([
      { policy: { authorize: parent } },
      { policy: { public: true } },
    ]);

    expect(access.chain).toHaveLength(1);
    expect(access.public).toBe(false);
  });

  it("removes each inherited hook only for an explicit exception", () => {
    const access = resolveRouteAccess([
      { policy: { authorize: parent }, source: "routes/@policy.ts" },
      {
        policy: {
          public: true,
          replaces: { reason: "The webhook uses a signature.", scope: "/hooks" },
        },
        source: "routes/hooks/@policy.ts",
      },
    ]);

    expect(access.chain).toHaveLength(0);
    expect(access.public).toBe(true);
    expect(access.exceptions).toEqual([
      {
        reason: "The webhook uses a signature.",
        scope: "/hooks",
        source: "routes/hooks/@policy.ts",
      },
    ]);
  });

  it("reports the effective authorization and each exception", () => {
    const audit = createSecurityAudit({
      route: {
        access: resolveRouteAccess([
          { policy: { authorize: parent }, source: "routes/@policy.ts" },
          {
            policy: { replaces: { reason: "Signed webhook." }, public: true },
            source: "routes/hooks/@policy.ts",
          },
        ]),
        method: "GET",
      },
    });

    expect(audit.route?.access?.public).toBe(true);
    expect(audit.findings).toContainEqual(
      expect.objectContaining({ code: "access-public" }),
    );
    expect(audit.findings).toContainEqual(
      expect.objectContaining({
        code: "access-exception",
        severity: "warning",
      }),
    );
  });

  it("permits a request for an object decision", async () => {
    const access = resolveRouteAccess([
      { policy: { authorize: () => ({ allow: true }) } },
    ]);

    await expect(
      authorizeRoute(access, {} as never),
    ).resolves.toBeNull();
  });

  it("uses the status that the decision selects", async () => {
    const access = resolveRouteAccess([
      { policy: { authorize: () => ({ allow: false, status: 404 }) } },
    ]);

    const response = await authorizeRoute(access, {} as never);

    expect(response?.status).toBe(404);
    await expect(response?.text()).resolves.toBe("Not Found.");
  });

  it("uses the status that the declaration selects", async () => {
    const access = resolveRouteAccess([
      { policy: { authorize: () => false, denyStatus: 401 } },
    ]);

    const response = await authorizeRoute(access, {} as never);

    expect(response?.status).toBe(401);
    await expect(response?.text()).resolves.toBe("Unauthorized.");
  });

  it("keeps a denial out of every cache", async () => {
    const response = await authorizeRoute(
      resolveRouteAccess([{ policy: { authorize: () => false } }]),
      {} as never,
    );

    expect(response?.headers.get("cache-control")).toBe("private, no-store");
  });

  it("keeps the source that an exception declares", () => {
    const access = resolveRouteAccess([
      {
        policy: {
          public: true,
          replaces: { reason: "Signed webhook.", source: "docs/decision.md" },
        },
        source: "routes/hooks/@policy.ts",
      },
    ]);

    expect(access.exceptions[0]?.source).toBe("docs/decision.md");
  });

  it("merges the access declarations of the route policy cascade", () => {
    const merged = mergeRoutePolicies(
      { access: { authorize: parent } },
      false,
      { access: { authorize: child } },
    );

    expect(merged.access.chain).toHaveLength(2);
    expect(merged.access.declared).toBe(true);
  });

  it("reports a route with no access declaration as an error", () => {
    const audit = createSecurityAudit({
      route: { access: resolveRouteAccess([]), method: "GET" },
    });

    expect(audit.findings).toContainEqual(
      expect.objectContaining({
        code: "access-declaration-missing",
        severity: "error",
      }),
    );
  });
});
