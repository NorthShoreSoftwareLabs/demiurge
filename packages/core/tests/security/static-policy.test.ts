import { describe, expect, it } from "vitest";
import {
  defineAdapter,
  defineRoutePolicy,
  json,
  page,
  security,
  text,
  type RouteModule,
} from "@demiurgejs/core";
import { validateRouteModules } from "../../src/security/verification";

function View() {
  return null;
}

describe("static route policy verification", () => {
  it("accepts valid CORS and rate limit policies", () => {
    expect(() =>
      validateRouteModules({
        "./routes/api.ts": {
          GET: json({}, {
            cors: {
              methods: ["GET", "POST", "HEAD"],
              origins: ["https://app.example.com"],
            },
          }),
          POST: text("ok", {
            security: {
              rateLimit: { key: "ip", limit: 10, window: "1m" },
            },
          }),
          policy: defineRoutePolicy({
            security: {
              rateLimit: { key: "ip", limit: 100, window: "1h" },
            },
          }),
        },
      })
    ).not.toThrow();
  });

  it("identifies the route export for an invalid CORS policy", () => {
    expect(() =>
      validateRouteModules({
        "./routes/api.ts": {
          POST: json({}, {
            cors: { credentials: true, origins: "*" },
          }),
        },
      })
    ).toThrow(
      'Route "./routes/api.ts" export POST has an invalid CORS policy. Demiurge CORS policy cannot use wildcard origins with credentials.',
    );
  });

  it("rejects CORS methods that the route cannot serve", () => {
    expect(() =>
      validateRouteModules({
        "./routes/api.ts": {
          PUT: json({}, {
            cors: { methods: ["POST"], origins: "*" },
          }),
        },
      })
    ).toThrow(
      'Route "./routes/api.ts" export PUT allows CORS method POST, but the route does not export that response capability.',
    );
  });

  it("treats a response GET export as an implicit HEAD capability", () => {
    expect(() =>
      validateRouteModules({
        "./routes/api.ts": {
          GET: json({}, {
            cors: { methods: ["GET", "HEAD"], origins: "*" },
          }),
        },
      })
    ).not.toThrow();
  });

  it("does not treat a page GET export as a CORS response capability", () => {
    expect(() =>
      validateRouteModules({
        "./routes/mixed.tsx": {
          GET: page(View),
          POST: json({}, {
            cors: { methods: ["GET"], origins: "*" },
          }),
        },
      })
    ).toThrow(
      'Route "./routes/mixed.tsx" export POST allows CORS method GET, but the route does not export that response capability.',
    );
  });

  it("identifies invalid capability and module rate limits", () => {
    expect(() =>
      validateRouteModules({
        "./routes/action.ts": {
          POST: json({}, {
            security: {
              rateLimit: { key: "ip", limit: 0, window: "1m" },
            },
          }),
        },
      })
    ).toThrow(
      'Route "./routes/action.ts" export POST has an invalid rate limit policy. Demiurge rate limit limit must be a positive integer.',
    );

    expect(() =>
      validateRouteModules({
        "./routes/@policy.ts": {
          policy: defineRoutePolicy({
            security: {
              rateLimit: { key: "ip", limit: 10, window: 0 },
            },
          }),
        },
      })
    ).toThrow(
      'Route "./routes/@policy.ts" export policy has an invalid rate limit policy. Demiurge rate limit window must be a positive integer.',
    );
  });

  it("checks the effective page CSP against adapter capabilities", () => {
    const staticAdapter = defineAdapter({
      name: "static",
      capabilities: { staticOutput: true },
    });
    const modules = {
      "./routes/@policy.ts": {
        policy: defineRoutePolicy({ document: security.strict() }),
      },
      "./routes/index.tsx": {
        GET: page(View),
      },
    } satisfies Record<string, RouteModule>;

    expect(() => validateRouteModules(modules, { adapter: staticAdapter }))
      .toThrow(
        'Route "./routes/index.tsx" export GET has an invalid effective CSP policy. Adapter "static" does not support required capabilities: nonceInjection.',
      );
  });

  it("checks fallback document policy without a page route", () => {
    const staticAdapter = defineAdapter({ name: "static" });
    const modules = {
      "./routes/@not-found.tsx": { default: View },
      "./routes/@policy.ts": {
        policy: defineRoutePolicy({ document: security.strict() }),
      },
    } satisfies Record<string, RouteModule>;

    expect(() => validateRouteModules(modules, { adapter: staticAdapter }))
      .toThrow(/invalid effective CSP policy.*nonceInjection/);
  });

  it("does not let a page override hide fallback adapter requirements", () => {
    const staticAdapter = defineAdapter({ name: "static" });
    const modules = {
      "./routes/@policy.ts": {
        policy: defineRoutePolicy({ document: security.strict() }),
      },
      "./routes/index.tsx": {
        GET: page(View),
        policy: defineRoutePolicy({ document: { csp: false } }),
      },
    } satisfies Record<string, RouteModule>;

    expect(() => validateRouteModules(modules, { adapter: staticAdapter }))
      .not.toThrow();
  });

  it("validates dynamic document policy during startup", () => {
    const modules = {
      "./routes/@policy.ts": {
        policy: defineRoutePolicy({
          document: security.strict({
            csp: { reportTo: "missing" },
            headers: { reportingEndpoints: { reports: "/reports" } },
          }),
        }),
      },
      "./routes/index.tsx": { GET: page(View) },
    } satisfies Record<string, RouteModule>;

    expect(() => validateRouteModules(modules)).toThrow(
      /invalid effective document policy.*report-to group "missing"/,
    );
  });
});
