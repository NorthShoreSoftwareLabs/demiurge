import { describe, expect, it } from "vitest";
import {
  analytics,
  defineRoutePolicy,
  defineScripts,
  mergeRoutePolicies,
  page,
  security,
} from "@demiurgejs/core";
import { validateRouteModules } from "../../src/security/verification";

function View() {
  return null;
}

const plausible = analytics.plausible({
  domain: "example.com",
  endpoint: "https://plausible.example.com",
});

describe("analytics policy verification", () => {
  it("widens every directive an integration declares", () => {
    const merged = mergeRoutePolicies(
      { document: security.strict() },
      analytics.policy(plausible),
    );

    expect(merged.document?.csp).toMatchObject({
      connectSrc: ["'self'", "https://plausible.example.com"],
      scriptSrc: [
        "'nonce-{nonce}'",
        "'strict-dynamic'",
        "https://plausible.example.com",
      ],
    });
  });

  it("accepts a route that wires both halves of an integration", () => {
    expect(() =>
      validateRouteModules({
        "./routes/@policy.ts": {
          policy: mergeRoutePolicies(
            { document: security.static() },
            analytics.policy(plausible),
          ),
        },
        "./routes/index.tsx": {
          GET: page({ render: { mode: "ssr" }, view: View }),
          scripts: defineScripts(analytics.scripts(plausible)),
        },
      })
    ).not.toThrow();
  });

  it("rejects a route that contributes the script without the policy", () => {
    expect(() =>
      validateRouteModules({
        "./routes/@policy.ts": {
          policy: defineRoutePolicy({ document: security.static() }),
        },
        "./routes/index.tsx": {
          GET: page({ render: { mode: "ssr" }, view: View }),
          scripts: defineScripts(analytics.scripts(plausible)),
        },
      })
    ).toThrow(
      /Route "\.\/routes\/index\.tsx" export GET declares script "https:\/\/plausible\.example\.com\/js\/script\.js" that violates the effective script-src 'self' policy\./,
    );
  });

  it("names the missing beacon directive when only script-src is widened", () => {
    expect(() =>
      validateRouteModules({
        "./routes/@policy.ts": {
          policy: defineRoutePolicy({
            document: security.static(),
            security: { needs: { script: ["https://plausible.example.com"] } },
          }),
        },
        "./routes/index.tsx": {
          GET: page({ render: { mode: "ssr" }, view: View }),
          scripts: defineScripts(analytics.scripts(plausible)),
        },
      })
    ).toThrow(
      'Route "./routes/index.tsx" export GET declares script "https://plausible.example.com/js/script.js" that needs connect-src https://plausible.example.com, which the effective policy does not allow. Add https://plausible.example.com to security.needs.connect or to csp.connectSrc for this route.',
    );
  });

  it("rejects a connect-src that the route removed outright", () => {
    expect(() =>
      validateRouteModules({
        "./routes/@policy.ts": {
          policy: defineRoutePolicy({
            document: security.static({ csp: { connectSrc: false } }),
            security: {
              needs: { connect: ["https://plausible.example.com"] },
            },
          }),
        },
        "./routes/index.tsx": {
          GET: page({ render: { mode: "ssr" }, view: View }),
        },
      })
    ).toThrow(
      "A route policy declares security.needs.connect and sets csp.connectSrc to false. Set an explicit csp.connectSrc that includes https://plausible.example.com.",
    );
  });

  it("accepts a wildcard host source that covers the declared origin", () => {
    const sentry = analytics.sentry({
      dsn: "https://abc123@o42.ingest.sentry.io/4505",
    });

    expect(() =>
      validateRouteModules({
        "./routes/@policy.ts": {
          policy: defineRoutePolicy({
            document: security.static({
              csp: {
                connectSrc: ["'self'", "https://*.ingest.sentry.io"],
                scriptSrc: ["'self'", "https://js.sentry-cdn.com"],
              },
            }),
          }),
        },
        "./routes/index.tsx": {
          GET: page({ render: { mode: "ssr" }, view: View }),
          scripts: defineScripts(analytics.scripts(sentry)),
        },
      })
    ).not.toThrow();
  });
});
