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

  it("accepts a CORS OPTIONS method the framework answers itself", () => {
    expect(() =>
      validateRouteModules({
        "./routes/api.ts": {
          GET: json({}, {
            cors: { methods: ["GET", "OPTIONS"], origins: "*" },
          }),
        },
      })
    ).not.toThrow();
  });

  it("returns the manifest it built to resolve the policy cascade", () => {
    const manifest = validateRouteModules({
      "./routes/index.tsx": { GET: page(View) },
    });

    expect(manifest.routes.map((route) => route.file)).toEqual([
      "./routes/index.tsx",
    ]);
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

  it("rejects nonce-backed directives for static pages", () => {
    const modules = {
      "./routes/@policy.ts": {
        policy: defineRoutePolicy({
          document: { csp: { scriptSrc: ["'nonce-{nonce}'"] } },
        }),
      },
      "./routes/index.tsx": {
        GET: page({ render: { mode: "static" }, view: View }),
      },
    } satisfies Record<string, RouteModule>;

    expect(() => validateRouteModules(modules)).toThrow(
      'Route "./routes/index.tsx" uses render mode "static" with an effective script-src directive that depends on a CSP nonce. Use security.static() for static output or remove the nonce source from the document policy.',
    );
  });

  it("accepts static pages when a child replacement removes inherited nonce sources", () => {
    const modules = {
      "./routes/@policy.ts": {
        policy: defineRoutePolicy({
          document: { csp: { scriptSrc: ["'nonce-{nonce}'"] } },
        }),
      },
      "./routes/index.tsx": {
        GET: page({
          render: { mode: "static" },
          view: View,
        }),
        policy: defineRoutePolicy({
          document: { csp: { scriptSrc: { replace: ["'self'"] } } },
        }),
      },
    } satisfies Record<string, RouteModule>;

    expect(() => validateRouteModules(modules)).not.toThrow();
  });

  it("uses default-src when streaming has no script-src directive", () => {
    const modules = {
      "./routes/@policy.ts": {
        policy: defineRoutePolicy({
          document: { csp: { defaultSrc: ["'self'"] } },
        }),
      },
      "./routes/index.tsx": {
        GET: page({ render: { mode: "streaming" }, view: View }),
      },
    } satisfies Record<string, RouteModule>;

    expect(() => validateRouteModules(modules)).toThrow(
      'Route "./routes/index.tsx" uses render mode "streaming" with an effective default-src directive that does not allow React runtime inline payload scripts.',
    );
  });

  it("accepts streaming pages without an effective script directive", () => {
    const modules = {
      "./routes/index.tsx": {
        GET: page({ render: { mode: "streaming" }, view: View }),
        policy: defineRoutePolicy({
          document: { csp: { imgSrc: ["'self'"] } },
        }),
      },
    } satisfies Record<string, RouteModule>;

    expect(() => validateRouteModules(modules)).not.toThrow();
  });

  it("does not treat unsafe-inline as effective when a hash source is present", () => {
    const modules = {
      "./routes/index.tsx": {
        GET: page({ render: { mode: "streaming" }, view: View }),
        policy: defineRoutePolicy({
          document: {
            csp: {
              scriptSrc: ["'unsafe-inline'", "'sha256-example'"],
            },
          },
        }),
      },
    } satisfies Record<string, RouteModule>;

    expect(() => validateRouteModules(modules)).toThrow(
      /render mode "streaming" with an effective script-src directive.*nonce or hash sources/,
    );
  });

  it("accepts an effective unsafe-inline policy for streaming pages", () => {
    const modules = {
      "./routes/index.tsx": {
        GET: page({ render: { mode: "streaming" }, view: View }),
        policy: defineRoutePolicy({
          document: { csp: { scriptSrc: ["'unsafe-inline'"] } },
        }),
      },
    } satisfies Record<string, RouteModule>;

    expect(() => validateRouteModules(modules)).not.toThrow();
  });

  it("accepts a strict nonce placeholder for streaming pages", () => {
    const modules = {
      "./routes/@policy.ts": {
        policy: defineRoutePolicy({ document: security.strict() }),
      },
      "./routes/index.tsx": {
        GET: page({ render: { mode: "streaming" }, view: View }),
      },
    } satisfies Record<string, RouteModule>;

    expect(() => validateRouteModules(modules)).not.toThrow();
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
