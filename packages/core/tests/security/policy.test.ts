import { describe, expect, it } from "vitest";
import {
  createCorsHeaders,
  createCsrfCookie,
  createCsrfToken,
  createMemoryRateLimitStore,
  createSecurityAudit,
  createSecurityHeaders,
  cspNonce,
  cspHash,
  defineRoutePolicy,
  defineSecurityPolicy,
  enforceAllowedMethods,
  enforceRateLimit,
  json,
  issueCsrfToken,
  mergeRoutePolicies,
  mergeSecurityPolicies,
  parseCookieHeader,
  parseBodySize,
  parseRateLimitWindow,
  security,
  script,
  validateCorsPolicy,
  validateRateLimitPolicy,
} from "@demiurgejs/core";
// createCorsPreflightResponse is an internal helper (not re-exported from the
// package root) that backs the request handler's OPTIONS preflight handling.
import { createCorsPreflightResponse } from "../../src/security/cors";

describe("security policy headers", () => {
  it("creates strict production security headers with a CSP nonce", () => {
    const headers = createSecurityHeaders(security.strict(), {
      nonce: "abc123",
    });

    expect(headers.get("content-security-policy")).toBe(
      [
        "base-uri 'self'",
        "connect-src 'self'",
        "default-src 'self'",
        "font-src 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "img-src 'self' data: blob:",
        "object-src 'none'",
        "script-src 'nonce-abc123' 'strict-dynamic'",
        "style-src 'self' 'nonce-abc123'",
        "upgrade-insecure-requests",
      ].join("; "),
    );
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(headers.get("permissions-policy")).toBe(
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
    expect(headers.get("strict-transport-security")).toBe("max-age=31536000");
  });

  it("does not send strict transport security on a plain HTTP response", () => {
    const headers = createSecurityHeaders(security.strict(), {
      nonce: "local-dev",
      request: new Request("http://localhost:3000/"),
    });

    expect(headers.has("strict-transport-security")).toBe(false);
  });

  it("fails when a nonce-backed CSP is rendered without a nonce", () => {
    expect(() => createSecurityHeaders(security.strict())).toThrow(
      "Demiurge security policy requires a CSP nonce.",
    );
  });

  it("allows routes to extend strict CSP directives", () => {
    const headers = createSecurityHeaders(
      security.strict({
        csp: {
          connectSrc: ["'self'", "https://api.example.com"],
          imgSrc: ["'self'", "https://images.example.com"],
        },
      }),
      { nonce: "route" },
    );

    expect(headers.get("content-security-policy")).toContain(
      "connect-src 'self' https://api.example.com",
    );
    expect(headers.get("content-security-policy")).toContain(
      "img-src 'self' data: blob: https://images.example.com",
    );
  });

  it("allows strict documents to permit only inline style attributes", () => {
    const headers = createSecurityHeaders(
      security.strict({
        csp: {
          styleSrcAttr: ["'unsafe-inline'"],
        },
      }),
      { nonce: "route" },
    );
    const value = headers.get("content-security-policy");

    expect(value).toContain("style-src 'self' 'nonce-route'");
    expect(value).toContain("style-src-attr 'unsafe-inline'");
  });

  it("exports the typed nonce source used by strict CSP", () => {
    const headers = createSecurityHeaders({
      csp: {
        scriptSrc: [cspNonce],
      },
    }, { nonce: "typed" });

    expect(cspNonce).toBe("'nonce-{nonce}'");
    expect(headers.get("content-security-policy")).toBe(
      "script-src 'nonce-typed'",
    );
  });

  it("renders the extended CSP source directives", () => {
    const headers = createSecurityHeaders({
      csp: {
        childSrc: ["'self'"],
        frameSrc: ["https://frames.example.com"],
        manifestSrc: ["'self'"],
        mediaSrc: ["https://media.example.com"],
        styleSrcAttr: ["'unsafe-inline'"],
        styleSrcElem: ["'self'", "https://styles.example.com"],
        workerSrc: ["'self'", "blob:"],
      },
    });
    const value = headers.get("content-security-policy");

    expect(value).toContain("child-src 'self'");
    expect(value).toContain("frame-src https://frames.example.com");
    expect(value).toContain("manifest-src 'self'");
    expect(value).toContain("media-src https://media.example.com");
    expect(value).toContain("style-src-attr 'unsafe-inline'");
    expect(value).toContain(
      "style-src-elem 'self' https://styles.example.com",
    );
    expect(value).toContain("worker-src 'self' blob:");
  });

  it.each([
    { scriptSrc: "'self'" },
    { scriptSrc: ["'self'", 1] },
    { scriptSrc: { replace: "'self'" } },
  ])("rejects a malformed CSP source directive value", (csp) => {
    expect(() => createSecurityHeaders({
      csp: csp as never,
    })).toThrow(
      'Demiurge CSP directive "script-src" must be a source list, false, or a replacement object with a source list.',
    );
  });

  it("names a malformed directive after preset policy merges", () => {
    const policy = security.static({
      csp: {
        styleSrc: { replace: "'self'" } as never,
      },
    });

    expect(() => createSecurityHeaders(policy)).toThrow(
      'Demiurge CSP directive "style-src" must be a source list, false, or a replacement object with a source list.',
    );
  });

  it.each([
    {
      csp: { reportTo: false },
      message: 'Demiurge CSP directive "report-to" must be a string.',
    },
    {
      csp: { upgradeInsecureRequests: "yes" },
      message:
        'Demiurge CSP directive "upgrade-insecure-requests" must be a boolean.',
    },
  ])("rejects a malformed CSP scalar directive", ({ csp, message }) => {
    expect(() => createSecurityHeaders({ csp: csp as never })).toThrow(message);
  });

  it("can disable CSP for API-only policies", () => {
    const headers = createSecurityHeaders(security.api());

    expect(headers.has("content-security-policy")).toBe(false);
    expect(headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("creates a cross-origin isolated preset", () => {
    const headers = createSecurityHeaders(security.preset("cross-origin-isolated"), {
      nonce: "isolate",
    });

    expect(headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(headers.get("cross-origin-embedder-policy")).toBe("require-corp");
  });

  it("creates static CSP headers without requiring a nonce", () => {
    const headers = createSecurityHeaders(security.preset("static"));

    expect(headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(headers.get("content-security-policy")).toContain("style-src 'self'");
    expect(headers.get("content-security-policy")).not.toContain("nonce-");
  });

  it("creates deterministic CSP hashes for static output", async () => {
    const hash = await cspHash("console.log('demo')");
    const headers = createSecurityHeaders(
      security.static({
        csp: {
          scriptSrc: ["'self'", hash],
        },
      }),
    );

    expect(hash).toBe("'sha256-g7KK/qfukTAg7aIkV6Z6HRyIMe5S6WH5Kh+rck3jha4='");
    expect(headers.get("content-security-policy")).toContain(
      `script-src 'self' ${hash}`,
    );
  });

  it("renders Trusted Types as CSP directives, not as headers of its own", () => {
    const headers = createSecurityHeaders({
      trustedTypes: {
        mode: "enforce",
        policies: ["demiurge", "dompurify"],
        requireFor: ["script"],
      },
    });

    expect(headers.get("content-security-policy")).toBe(
      "require-trusted-types-for 'script'; trusted-types demiurge dompurify",
    );
    expect(headers.has("trusted-types")).toBe(false);
    expect(headers.has("trusted-types-report-only")).toBe(false);
    expect(headers.has("require-trusted-types-for")).toBe(false);
  });

  it("appends enforced Trusted Types directives to the document policy", () => {
    const headers = createSecurityHeaders(
      security.static({
        trustedTypes: {
          mode: "enforce",
          policies: ["demiurge"],
          requireFor: ["script"],
        },
      }),
    );
    const csp = headers.get("content-security-policy") ?? "";

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("require-trusted-types-for 'script'");
    expect(csp).toContain("trusted-types demiurge");
    expect(headers.has("content-security-policy-report-only")).toBe(false);
  });

  // The doctrine this framework follows: a control that can only fail inside a
  // user's browser reports rather than breaking it. That means an enforcing CSP
  // and a reporting Trusted Types policy on the same response, which is only
  // expressible across two headers.
  it("reports Trusted Types separately while the rest of the policy enforces", () => {
    const headers = createSecurityHeaders(
      security.static({
        trustedTypes: {
          mode: "report-only",
          policies: ["demiurge", "dompurify"],
          requireFor: ["script"],
        },
      }),
    );

    expect(headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(headers.get("content-security-policy")).not.toContain("trusted-types");
    expect(headers.get("content-security-policy-report-only")).toBe(
      "require-trusted-types-for 'script'; trusted-types demiurge dompurify",
    );
  });

  it("renders modern and compatibility reporting targets on both CSP policies", () => {
    const headers = createSecurityHeaders({
      csp: {
        defaultSrc: ["'self'"],
        reportTo: "csp-endpoint",
        reportUri: ["/security/reports"],
      },
      headers: {
        reportingEndpoints: {
          metrics: "https://reports.example.com/metrics",
          "csp-endpoint": "/security/reports",
        },
      },
      trustedTypes: {
        mode: "report-only",
        policies: ["demiurge"],
        requireFor: ["script"],
      },
    });

    expect(headers.get("reporting-endpoints")).toBe(
      'csp-endpoint="/security/reports", metrics="https://reports.example.com/metrics"',
    );
    expect(headers.get("content-security-policy")).toBe(
      "default-src 'self'; report-uri /security/reports; report-to csp-endpoint",
    );
    expect(headers.get("content-security-policy-report-only")).toBe(
      "require-trusted-types-for 'script'; trusted-types demiurge; report-uri /security/reports; report-to csp-endpoint",
    );
  });

  it("rejects invalid reporting endpoint and group configuration", () => {
    expect(() => createSecurityHeaders({
      headers: {
        reportingEndpoints: {
          "Bad Group": "/reports",
        },
      },
    })).toThrow(/Invalid reporting endpoint name/);

    expect(() => createSecurityHeaders({
      csp: {
        reportTo: "missing",
      },
    })).toThrow(
      'Demiurge CSP report-to group "missing" is not defined in headers.reportingEndpoints.',
    );

    expect(() => createSecurityHeaders({
      headers: {
        reportingEndpoints: {
          csp: "http://reports.example.com/csp" as `https://${string}`,
        },
      },
    })).toThrow(/same-origin path or an HTTPS URL/);

    expect(() => createSecurityHeaders({
      csp: {
        reportUri: ["/reports; script-src *" as `/${string}`],
      },
    })).toThrow(/same-origin path or an HTTPS URL/);

    expect(() => createSecurityHeaders({
      headers: {
        reportingEndpoints: {
          csp: '/reports", injected="https://evil.example' as `/${string}`,
        },
      },
    })).toThrow(/same-origin path or an HTTPS URL/);
  });

  it("omits the Trusted Types directives when no policy is configured", () => {
    const headers = createSecurityHeaders(security.static());

    expect(headers.get("content-security-policy")).not.toContain("trusted-types");
    expect(headers.has("content-security-policy-report-only")).toBe(false);
  });

  it("renders optional strict transport security directives", () => {
    const headers = createSecurityHeaders(
      security.api({
        headers: {
          strictTransportSecurity: {
            includeSubDomains: true,
            maxAge: 63072000,
            preload: true,
          },
        },
      }),
    );

    expect(headers.get("strict-transport-security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
  });
});

describe("security policy cascade", () => {
  it("defines app-owned security policy objects", () => {
    const policy = defineSecurityPolicy({
      headers: {
        referrerPolicy: "same-origin",
      },
    });

    expect(policy.headers?.referrerPolicy).toBe("same-origin");
  });

  it("merges CSP source directives additively from parent to child", () => {
    const policy = mergeSecurityPolicies(
      security.static(),
      {
        csp: {
          connectSrc: ["https://api.example.com"],
          imgSrc: ["https://images.example.com"],
        },
      },
      {
        csp: {
          connectSrc: ["https://metrics.example.com", "https://api.example.com"],
        },
      },
    );
    const headers = createSecurityHeaders(policy);

    expect(headers.get("content-security-policy")).toContain(
      "connect-src 'self' https://api.example.com https://metrics.example.com",
    );
    expect(headers.get("content-security-policy")).toContain(
      "img-src 'self' data: blob: https://images.example.com",
    );
  });

  it("lets child policy replace an inherited CSP source directive", () => {
    const policy = mergeSecurityPolicies(
      security.static(),
      {
        csp: {
          scriptSrc: { replace: ["https://scripts.example.com"] },
        },
      },
    );
    const csp = createSecurityHeaders(policy).get("content-security-policy");

    expect(csp).toContain("script-src https://scripts.example.com");
    expect(csp).not.toContain("script-src 'self'");
  });

  it("lets child policy remove one inherited CSP directive", () => {
    const policy = mergeSecurityPolicies(
      security.static(),
      {
        csp: {
          objectSrc: false,
        },
      },
    );
    const csp = createSecurityHeaders(policy).get("content-security-policy");

    expect(csp).not.toContain("object-src");
    expect(csp).toContain("default-src 'self'");
  });

  it("keeps report URI arrays additive unless child policy replaces them", () => {
    const additive = mergeSecurityPolicies(
      { csp: { reportUri: ["/parent-reports"] } },
      { csp: { reportUri: ["/child-reports"] } },
    );
    const replaced = mergeSecurityPolicies(
      additive,
      { csp: { reportUri: { replace: ["/final-reports"] } } },
    );

    expect(createSecurityHeaders(additive).get("content-security-policy")).toBe(
      "report-uri /parent-reports /child-reports",
    );
    expect(createSecurityHeaders(replaced).get("content-security-policy")).toBe(
      "report-uri /final-reports",
    );
  });

  it("merges reporting endpoint groups while overriding the selected CSP group", () => {
    const policy = mergeSecurityPolicies(
      {
        csp: { reportTo: "csp" },
        headers: { reportingEndpoints: { csp: "/csp-reports" } },
      },
      {
        csp: { reportTo: "runtime" },
        headers: { reportingEndpoints: { runtime: "/runtime-reports" } },
      },
    );
    const headers = createSecurityHeaders(policy);

    expect(headers.get("reporting-endpoints")).toBe(
      'csp="/csp-reports", runtime="/runtime-reports"',
    );
    expect(headers.get("content-security-policy")).toBe("report-to runtime");
  });

  it("lets child policy override scalar security headers", () => {
    const policy = mergeSecurityPolicies(
      security.strict({
        headers: {
          referrerPolicy: "same-origin",
        },
      }),
      {
        headers: {
          referrerPolicy: "no-referrer",
        },
      },
    );

    expect(
      createSecurityHeaders(policy, { nonce: "cascade" }).get("referrer-policy"),
    ).toBe("no-referrer");
  });

  it("lets child policy explicitly disable inherited CSP", () => {
    const policy = mergeSecurityPolicies(
      security.strict(),
      {
        csp: false,
      },
    );

    expect(createSecurityHeaders(policy).has("content-security-policy")).toBe(false);
  });

  it("defines and merges route policy from parent to child", () => {
    const policy = mergeRoutePolicies(
      defineRoutePolicy({
        document: security.api(),
        security: {
          csrf: true,
          request: {
            allowedMethods: ["POST"],
            maxBodySize: "1mb",
          },
        },
      }),
      {
        security: {
          request: {
            maxBodySize: "16kb",
          },
        },
      },
    );

    expect(policy.document?.headers?.contentTypeOptions).toBe("nosniff");
    expect(policy.security?.csrf).toBe(true);
    expect(policy.security?.request).toEqual({
      allowedMethods: ["POST"],
      maxBodySize: "16kb",
    });
  });

  it("cascades script needs additively and preserves first declaration order", () => {
    const policy = mergeRoutePolicies(
      {
        document: security.static(),
        security: {
          needs: {
            script: ["https://cdn.example.com/root.js", "https://shared.example.com"],
          },
        },
      },
      {
        security: {
          needs: {
            script: ["https://shared.example.com", "https://cdn.example.com/leaf.js"],
          },
        },
      },
    );

    expect(policy.security?.needs?.script).toEqual([
      "https://cdn.example.com/root.js",
      "https://shared.example.com",
      "https://cdn.example.com/leaf.js",
    ]);
    expect(createSecurityHeaders(policy.document!).get("content-security-policy"))
      .toContain(
        "script-src 'self' https://cdn.example.com/root.js https://shared.example.com https://cdn.example.com/leaf.js",
      );
  });

  it("extends the effective default-src fallback when script-src is removed", () => {
    const policy = mergeRoutePolicies(
      {
        document: {
          csp: {
            defaultSrc: ["'self'"],
            scriptSrc: false,
          },
        },
        security: {
          needs: { script: ["https://cdn.example.com"] },
        },
      },
    );

    expect(policy.document?.csp).toEqual({
      defaultSrc: ["'self'", "https://cdn.example.com"],
      scriptSrc: false,
    });
    expect(createSecurityHeaders(policy.document!).get("content-security-policy"))
      .toBe("default-src 'self' https://cdn.example.com");
  });

  it("preserves default-src sources when needs adds an explicit script-src", () => {
    const policy = mergeRoutePolicies(
      {
        document: {
          csp: { defaultSrc: ["'self'"] },
        },
        security: {
          needs: { script: ["https://cdn.example.com"] },
        },
      },
    );

    expect(policy.document?.csp && policy.document.csp.scriptSrc).toEqual([
      "'self'",
      "https://cdn.example.com",
    ]);
  });

  it("does not create script-src when the document has no script fallback", () => {
    const policy = mergeRoutePolicies(
      {
        document: { csp: { objectSrc: ["'none'"] } },
        security: {
          needs: { script: ["https://cdn.example.com"] },
        },
      },
    );

    expect(policy.document?.csp).toEqual({ objectSrc: ["'none'"] });
  });

  it("activates strict-dynamic only when a nonce or hash source exists", () => {
    const scriptTag = script({ src: "https://cdn.example.com/app.js" });
    const inactive = createSecurityAudit({
      document: {
        policy: {
          csp: {
            scriptSrc: ["https://cdn.example.com", "'strict-dynamic'"],
          },
        },
        scripts: [scriptTag],
      },
    });
    const active = createSecurityAudit({
      document: {
        policy: {
          csp: {
            scriptSrc: [
              "https://cdn.example.com",
              "'strict-dynamic'",
              "'nonce-build'",
            ],
          },
        },
        scripts: [scriptTag],
      },
    });

    expect(inactive.findings).toEqual([]);
    expect(active.findings).toContainEqual(
      expect.objectContaining({ code: "csp-script-src-blocked" }),
    );
  });
});

describe("security audit output", () => {
  it("warns when report-only Trusted Types has no deliverable target", () => {
    const audit = createSecurityAudit({
      document: {
        policy: {
          trustedTypes: {
            mode: "report-only",
            policies: ["demiurge"],
          },
        },
      },
    });

    expect(audit.findings).toContainEqual({
      code: "report-only-target-missing",
      message:
        "Trusted Types report-only mode has no deliverable target. Configure CSP reportTo with a matching Reporting-Endpoints member, reportUri for compatibility, or both.",
      severity: "warning",
    });
  });

  it("accepts a mapped Reporting API target for report-only Trusted Types", () => {
    const audit = createSecurityAudit({
      document: {
        policy: {
          csp: { reportTo: "csp" },
          headers: { reportingEndpoints: { csp: "/reports" } },
          trustedTypes: {
            mode: "report-only",
            policies: ["demiurge"],
          },
        },
      },
    });

    expect(audit.findings).toEqual([]);
  });

  it("audits rendered document headers and effective route policy", () => {
    const audit = createSecurityAudit({
      document: {
        headers: {
          nonce: "audit",
        },
        policy: security.strict(),
      },
      route: {
        cors: {
          origins: ["https://app.example.com"],
        },
        method: "POST",
        security: {
          csrf: true,
          rateLimit: {
            key: "ip",
            limit: 60,
            window: "1m",
          },
          request: {
            maxBodySize: "1mb",
          },
        },
      },
    });

    expect(audit.headers["content-security-policy"]).toContain(
      "script-src 'nonce-audit' 'strict-dynamic'",
    );
    expect(audit.route?.method).toBe("POST");
    expect(audit.route?.security?.csrf).toBe(true);
    expect(audit.findings).toEqual([]);
  });

  it("reports security header rendering failures", () => {
    const audit = createSecurityAudit({
      document: {
        policy: security.strict(),
      },
    });

    expect(audit.headers).toEqual({});
    expect(audit.findings).toContainEqual({
      code: "security-header-render-failed",
      message: "Demiurge security policy requires a CSP nonce.",
      severity: "error",
    });
  });

  it("reports invalid CORS and missing unsafe route controls", () => {
    const audit = createSecurityAudit({
      route: {
        cors: {
          credentials: true,
          origins: "*",
        },
        method: "POST",
        security: {
          csrf: false,
        },
      },
    });

    expect(audit.findings.map((finding) => finding.code)).toEqual([
      "cors-invalid",
      "csrf-disabled",
      "rate-limit-missing",
      "request-body-limit-missing",
    ]);
  });

  it("does not warn safe route methods about unsafe-route controls", () => {
    const audit = createSecurityAudit({
      route: {
        method: "GET",
      },
    });

    expect(audit.findings).toEqual([]);
  });

  it("does not report omitted CSRF policy because cookie requests are protected by default", () => {
    const audit = createSecurityAudit({
      route: {
        method: "POST",
        security: {
          rateLimit: { key: "ip", limit: 10, window: "1m" },
          request: { maxBodySize: "1mb" },
        },
      },
    });

    expect(audit.findings).toEqual([]);
  });

  it("reports static document scripts blocked by the effective CSP", () => {
    const audit = createSecurityAudit({
      document: {
        policy: security.static(),
        scripts: [
          script({
            src: "/assets/app.js",
          }),
          script({
            src: "https://js.stripe.com/v3/",
          }),
        ],
      },
    });

    expect(audit.findings).toEqual([
      {
        code: "csp-script-src-blocked",
        message:
          "Document script https://js.stripe.com/v3/ is not allowed by the effective script-src policy.",
        severity: "error",
      },
    ]);
  });

  it("accepts document scripts allowed by script-src hosts", () => {
    const audit = createSecurityAudit({
      document: {
        policy: security.static({
          csp: {
            scriptSrc: ["'self'", "https://js.stripe.com"],
          },
        }),
        scripts: [
          script({
            src: "https://js.stripe.com/v3/",
          }),
        ],
      },
    });

    expect(audit.findings).toEqual([]);
  });

  it("reports strict nonce-backed document scripts without a matching nonce", () => {
    const audit = createSecurityAudit({
      document: {
        headers: {
          nonce: "audit",
        },
        policy: security.strict(),
        scripts: [
          script({
            src: "https://cdn.example.com/root.js",
          }),
          script({
            nonce: "audit",
            src: "https://cdn.example.com/nonced.js",
          }),
        ],
      },
    });

    expect(audit.findings).toEqual([
      {
        code: "csp-script-missing-nonce",
        message:
          "Document script https://cdn.example.com/root.js needs a nonce for the effective script-src policy.",
        severity: "error",
      },
    ]);
  });
});

describe("CORS policy headers", () => {
  it("renders CORS headers for allowed origins", () => {
    const headers = createCorsHeaders(
      {
        credentials: true,
        exposeHeaders: ["x-request-id"],
        origins: ["https://app.example.com"],
      },
      {
        request: new Request("https://api.example.test", {
          headers: {
            origin: "https://app.example.com",
          },
        }),
      },
    );

    expect(headers.get("access-control-allow-origin")).toBe(
      "https://app.example.com",
    );
    expect(headers.get("access-control-allow-credentials")).toBe("true");
    expect(headers.get("access-control-expose-headers")).toBe("x-request-id");
    expect(headers.get("vary")).toBe("Origin");
  });

  it("renders preflight CORS headers", () => {
    const headers = createCorsHeaders(
      {
        headers: ["content-type", "authorization"],
        maxAge: 600,
        origins: "*",
      },
      {
        request: new Request("https://api.example.test", {
          headers: {
            origin: "https://app.example.com",
          },
        }),
      },
      {
        methods: ["POST"],
        preflight: true,
      },
    );

    expect(headers.get("access-control-allow-origin")).toBe("*");
    expect(headers.get("access-control-allow-methods")).toBe("POST");
    expect(headers.get("access-control-allow-headers")).toBe(
      "content-type, authorization",
    );
    expect(headers.get("access-control-max-age")).toBe("600");
  });

  it("uses requested preflight headers when policy headers are omitted", () => {
    const headers = createCorsHeaders(
      {
        origins: "*",
      },
      {
        request: new Request("https://api.example.test", {
          headers: {
            "access-control-request-headers": "x-demo, x-trace",
            origin: "https://app.example.com",
          },
        }),
      },
      {
        methods: ["PUT"],
        preflight: true,
      },
    );

    expect(headers.get("access-control-allow-headers")).toBe("x-demo, x-trace");
  });

  it("varies allowlist responses even when the request has no allowed origin", () => {
    const noOrigin = createCorsHeaders(
      {
        origins: ["https://app.example.com"],
      },
      {
        request: new Request("https://api.example.test"),
      },
    );
    const deniedOrigin = createCorsHeaders(
      {
        origins: ["https://app.example.com"],
      },
      {
        request: new Request("https://api.example.test", {
          headers: {
            origin: "https://evil.example.com",
          },
        }),
      },
    );

    expect(Object.fromEntries(noOrigin)).toEqual({ vary: "Origin" });
    expect(Object.fromEntries(deniedOrigin)).toEqual({ vary: "Origin" });
  });

  it("rejects wildcard origins with credentials", () => {
    expect(() =>
      validateCorsPolicy({
        credentials: true,
        origins: "*",
      }),
    ).toThrow(
      "Demiurge CORS policy cannot use wildcard origins with credentials.",
    );
  });

  it("rejects wildcard headers and invalid max ages for credentialed CORS", () => {
    expect(() =>
      validateCorsPolicy({
        credentials: true,
        headers: ["*"],
        origins: ["https://app.example.com"],
      })
    ).toThrow(
      "Demiurge credentialed CORS policy must list allowed and exposed headers explicitly.",
    );
    expect(() =>
      validateCorsPolicy({
        credentials: true,
        exposeHeaders: ["*"],
        origins: ["https://app.example.com"],
      })
    ).toThrow(
      "Demiurge credentialed CORS policy must list allowed and exposed headers explicitly.",
    );
    expect(() =>
      validateCorsPolicy({
        maxAge: -1,
        origins: "*",
      })
    ).toThrow(
      "Demiurge CORS maxAge must be a non-negative integer number of seconds.",
    );
    expect(() =>
      validateCorsPolicy({
        maxAge: 1.5,
        origins: "*",
      })
    ).toThrow(
      "Demiurge CORS maxAge must be a non-negative integer number of seconds.",
    );
  });

  it.each([
    "https://app.example.com/",
    "https://app.example.com/path",
    "https://app.example.com?mode=test",
    "https://app.example.com#section",
    "https://user@app.example.com",
    "https://APP.example.com",
    "ftp://app.example.com",
    "not-an-origin",
  ])("rejects non-canonical CORS origin %s", (origin) => {
    expect(() => validateCorsPolicy({ origins: [origin] })).toThrow(
      `Demiurge CORS origin ${JSON.stringify(origin)} must be a canonical HTTP(S) origin without credentials, a path, query, or fragment.`,
    );
  });

  it("accepts canonical HTTP and HTTPS CORS origins", () => {
    expect(() => validateCorsPolicy({
      origins: [
        "https://app.example.com",
        "http://localhost:4173",
      ],
    })).not.toThrow();
  });

  it("omits the expose-headers header when no headers are configured to expose", () => {
    const headers = createCorsHeaders(
      {
        origins: ["https://app.example.com"],
      },
      {
        request: new Request("https://api.example.test", {
          headers: {
            origin: "https://app.example.com",
          },
        }),
      },
    );

    expect(headers.has("access-control-expose-headers")).toBe(false);
  });

  it("does not set a Vary header for wildcard origins", () => {
    const headers = createCorsHeaders(
      {
        origins: "*",
      },
      {
        request: new Request("https://api.example.test", {
          headers: {
            origin: "https://app.example.com",
          },
        }),
      },
    );

    expect(headers.has("vary")).toBe(false);
  });

  it("declares the server's allowed preflight headers regardless of what the browser requested", () => {
    const headers = createCorsHeaders(
      {
        headers: ["content-type"],
        origins: "*",
      },
      {
        request: new Request("https://api.example.test", {
          headers: {
            "access-control-request-headers": "x-not-configured",
            origin: "https://app.example.com",
          },
        }),
      },
      {
        methods: ["POST"],
        preflight: true,
      },
    );

    expect(headers.get("access-control-allow-headers")).toBe("content-type");
  });
});

describe("CORS preflight requests", () => {
  it("skips preflight handling when the Access-Control-Request-Method header is missing", () => {
    const routeModule = {
      GET: json({}, { cors: { origins: "*" } }),
    };
    const request = new Request("https://api.example.test", {
      headers: {
        origin: "https://app.example.com",
      },
      method: "OPTIONS",
    });

    expect(createCorsPreflightResponse(routeModule, request)).toBe(null);
  });

  it("rejects preflight requests for a method outside the route's explicit CORS allow-list", () => {
    const routeModule = {
      PUT: json({}, { cors: { methods: ["POST"], origins: "*" } }),
    };
    const request = new Request("https://api.example.test", {
      headers: {
        "access-control-request-method": "PUT",
        origin: "https://app.example.com",
      },
      method: "OPTIONS",
    });

    expect(createCorsPreflightResponse(routeModule, request)).toBe(null);
  });

  it("derives allowed preflight methods from the route module when the policy omits them", () => {
    const routeModule = {
      GET: json({}, { cors: { origins: "*" } }),
      POST: json({}, { cors: { origins: "*" } }),
    };
    const request = new Request("https://api.example.test", {
      headers: {
        "access-control-request-method": "POST",
        origin: "https://app.example.com",
      },
      method: "OPTIONS",
    });

    const response = createCorsPreflightResponse(routeModule, request);

    expect(response?.status).toBe(204);
    // HEAD is implicitly derived alongside GET, since GET capabilities also serve HEAD.
    expect(response?.headers.get("access-control-allow-methods")).toBe(
      "GET, POST, HEAD",
    );
  });

  it("falls back to the GET capability's CORS policy for HEAD preflight when HEAD is undefined", () => {
    const routeModule = {
      GET: json({}, { cors: { methods: ["GET", "HEAD"], origins: "*" } }),
    };
    const request = new Request("https://api.example.test", {
      headers: {
        "access-control-request-method": "HEAD",
        origin: "https://app.example.com",
      },
      method: "OPTIONS",
    });

    const response = createCorsPreflightResponse(routeModule, request);

    expect(response?.status).toBe(204);
    expect(response?.headers.get("access-control-allow-methods")).toBe(
      "GET, HEAD",
    );
  });

  it("uses an explicit HEAD capability's CORS policy instead of falling back to GET", () => {
    const routeModule = {
      GET: json({}, {
        cors: { methods: ["GET"], origins: ["https://other.example.com"] },
      }),
      HEAD: json({}, {
        cors: { methods: ["HEAD"], origins: ["https://app.example.com"] },
      }),
    };
    const request = new Request("https://api.example.test", {
      headers: {
        "access-control-request-method": "HEAD",
        origin: "https://app.example.com",
      },
      method: "OPTIONS",
    });

    const response = createCorsPreflightResponse(routeModule, request);

    expect(response?.status).toBe(204);
    expect(response?.headers.get("access-control-allow-methods")).toBe("HEAD");
    expect(response?.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.com",
    );
    expect(response?.headers.get("vary")).toBe("Origin");
  });
});

describe("request security policy", () => {
  it("parses request body size limits", () => {
    expect(parseBodySize(12)).toBe(12);
    expect(parseBodySize("10b")).toBe(10);
    expect(parseBodySize("2kb")).toBe(2048);
    expect(parseBodySize("3mb")).toBe(3 * 1024 ** 2);
    expect(parseBodySize("1gb")).toBe(1024 ** 3);
  });

  it("rejects invalid request body size limits", () => {
    expect(() => parseBodySize(-1)).toThrow(
      "Demiurge request maxBodySize must be a non-negative integer.",
    );
    expect(() => parseBodySize("10tb")).toThrow(
      "Demiurge request maxBodySize must use bytes or a b/kb/mb/gb suffix.",
    );
  });

  it("enforces explicit request allowed methods", () => {
    expect(enforceAllowedMethods(undefined, "POST")).toBe(null);
    expect(enforceAllowedMethods({ allowedMethods: ["POST"] }, "POST")).toBe(null);
    expect(enforceAllowedMethods({ allowedMethods: ["GET"] }, "HEAD")).toBe(null);

    const response = enforceAllowedMethods({ allowedMethods: ["GET"] }, "POST");

    expect(response?.status).toBe(405);
    expect(response?.headers.get("allow")).toBe("GET, HEAD");
  });
});

describe("rate limit policy", () => {
  it("rejects invalid in-memory store entry limits", () => {
    expect(() =>
      createMemoryRateLimitStore({ maximumEntries: 0 }),
    ).toThrow(
      "Demiurge rate limit maximumEntries must be a positive integer.",
    );
  });

  it("evicts the oldest entry when the in-memory store reaches its ceiling", () => {
    const store = createMemoryRateLimitStore({ maximumEntries: 2 });

    expect(store.increment("alice", 60_000, 0).count).toBe(1);
    expect(store.increment("bob", 60_000, 0).count).toBe(1);
    expect(store.increment("carol", 60_000, 0).count).toBe(1);
    expect(store.increment("alice", 60_000, 1).count).toBe(1);
    expect(store.increment("carol", 60_000, 1).count).toBe(2);
  });

  it("sweeps expired in-memory entries before enforcing the ceiling", () => {
    const store = createMemoryRateLimitStore({ maximumEntries: 2 });

    expect(store.increment("expired", 10, 0).count).toBe(1);
    expect(store.increment("active", 100, 0).count).toBe(1);
    expect(store.increment("new", 100, 10).count).toBe(1);
    expect(store.increment("active", 100, 10).count).toBe(2);
    expect(store.increment("expired", 100, 10).count).toBe(1);
  });

  it("does not enforce a rate limit when no policy is configured", () => {
    const store = createMemoryRateLimitStore();
    const request = new Request("https://example.test");

    expect(enforceRateLimit(undefined, request, store, 0)).toBe(null);
  });

  it("parses rate limit windows", () => {
    expect(parseRateLimitWindow(250)).toBe(250);
    expect(parseRateLimitWindow("10s")).toBe(10_000);
    expect(parseRateLimitWindow("2m")).toBe(120_000);
    expect(parseRateLimitWindow("1h")).toBe(3_600_000);
  });

  it("rejects invalid rate limit policy", () => {
    expect(() =>
      validateRateLimitPolicy({
        key: "ip",
        limit: 0,
        window: "1m",
      }),
    ).toThrow("Demiurge rate limit limit must be a positive integer.");
    expect(() => parseRateLimitWindow("1d")).toThrow(
      "Demiurge rate limit window must use an s/m/h suffix.",
    );
  });

  it("enforces fixed-window rate limits with memory storage", async () => {
    const store = createMemoryRateLimitStore();
    const policy = {
      key: {
        header: "x-user-id",
      },
      limit: 2,
      window: "1m",
    } as const;
    const request = new Request("https://example.test", {
      headers: {
        "x-user-id": "demo",
      },
    });

    expect(enforceRateLimit(policy, request, store, 0)).toBe(null);
    expect(enforceRateLimit(policy, request, store, 1)).toBe(null);

    const response = enforceRateLimit(policy, request, store, 2);

    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("60");
    expect(response?.headers.get("x-ratelimit-limit")).toBe("2");
    expect(response?.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(response?.headers.get("x-ratelimit-reset")).toBe("60");
    await expect(response?.text()).resolves.toBe("Rate limit exceeded.");
  });

  it("rejects numeric rate limit windows that are not positive integers", () => {
    expect(() => parseRateLimitWindow(0)).toThrow(
      "Demiurge rate limit window must be a positive integer.",
    );
    expect(() => parseRateLimitWindow(-500)).toThrow(
      "Demiurge rate limit window must be a positive integer.",
    );
    expect(() => parseRateLimitWindow(12.5)).toThrow(
      "Demiurge rate limit window must be a positive integer.",
    );
  });

  it("rejects rate limit windows whose computed duration overflows a safe integer", () => {
    expect(() => parseRateLimitWindow("3000000000h")).toThrow(
      "Demiurge rate limit window is too large.",
    );
  });

  it("resets the counter once the fixed window boundary has passed", () => {
    const store = createMemoryRateLimitStore();
    const policy = {
      key: { header: "x-user-id" },
      limit: 1,
      window: "1s",
    } as const;
    const request = new Request("https://example.test", {
      headers: { "x-user-id": "demo" },
    });

    expect(enforceRateLimit(policy, request, store, 0)).toBe(null);
    expect(enforceRateLimit(policy, request, store, 999)?.status).toBe(429);
    // exactly at resetAt the window has elapsed, so the counter rolls over
    expect(enforceRateLimit(policy, request, store, 1000)).toBe(null);
    expect(enforceRateLimit(policy, request, store, 1000)?.status).toBe(429);
  });

  it("tracks rate limit keys independently per requester", () => {
    const store = createMemoryRateLimitStore();
    const policy = {
      key: { header: "x-user-id" },
      limit: 1,
      window: "1m",
    } as const;
    const requestAlice = new Request("https://example.test", {
      headers: { "x-user-id": "alice" },
    });
    const requestBob = new Request("https://example.test", {
      headers: { "x-user-id": "bob" },
    });

    expect(enforceRateLimit(policy, requestAlice, store, 0)).toBe(null);
    expect(enforceRateLimit(policy, requestAlice, store, 0)?.status).toBe(429);
    // bob's key is unaffected by alice having exhausted her own limit
    expect(enforceRateLimit(policy, requestBob, store, 0)).toBe(null);
  });

  it("counts requests arriving in the same instant toward the same limit", () => {
    const store = createMemoryRateLimitStore();
    const policy = {
      key: { header: "x-user-id" },
      limit: 3,
      window: "1m",
    } as const;
    const request = new Request("https://example.test", {
      headers: { "x-user-id": "demo" },
    });
    const now = 1_000;

    const results = [1, 2, 3, 4].map(() =>
      enforceRateLimit(policy, request, store, now),
    );

    expect(results.slice(0, 3)).toEqual([null, null, null]);
    expect(results[3]?.status).toBe(429);
  });

  it("does not trust caller-controlled forwarding headers for IP rate limits", () => {
    const store = createMemoryRateLimitStore();
    const policy = { key: "ip", limit: 1, window: "1m" } as const;
    const forwarded = new Request("https://example.test", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    });
    const cloudflare = new Request("https://example.test", {
      headers: { "cf-connecting-ip": "198.51.100.4" },
    });

    expect(enforceRateLimit(policy, forwarded, store, 0)).toBe(null);
    expect(enforceRateLimit(policy, cloudflare, store, 0)?.status).toBe(429);
  });

  it("clamps retry-after and remaining when a custom store returns already-expired state", () => {
    const misbehavingStore = {
      increment: () => ({ count: 5, resetAt: -1_000 }),
    };
    const policy = { key: { header: "x-user-id" }, limit: 1, window: "1m" } as const;
    const request = new Request("https://example.test", {
      headers: { "x-user-id": "demo" },
    });

    const response = enforceRateLimit(policy, request, misbehavingStore, 0);

    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("0");
    expect(response?.headers.get("x-ratelimit-remaining")).toBe("0");
  });
});

describe("CSRF policy helpers", () => {
  it("issues high-entropy URL-safe tokens and secure readable cookies", () => {
    const first = issueCsrfToken();
    const second = createCsrfToken();

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first.token);
    expect(first.cookie).toBe(
      `csrf-token=${first.token}; Path=/; SameSite=Lax; Secure`,
    );
    expect(first.cookie).not.toContain("HttpOnly");
  });

  it("supports a matching custom cookie name and an explicit local HTTP mode", () => {
    expect(
      createCsrfCookie("hello world", {
        cookie: "demo-csrf",
        secure: false,
      }),
    ).toBe("demo-csrf=hello%20world; Path=/; SameSite=Lax");
  });

  it("rejects invalid CSRF cookie names and empty tokens", () => {
    expect(() => createCsrfCookie("token", { cookie: "bad=name" })).toThrow(
      "Demiurge CSRF cookie name is invalid.",
    );
    expect(() => createCsrfCookie("")).toThrow(
      "Demiurge CSRF token must not be empty.",
    );
  });

  it("parses cookie headers for CSRF validation", () => {
    expect(
      Object.fromEntries(
        parseCookieHeader("session=abc; csrf-token=hello%20world; flag"),
      ),
    ).toEqual({
      "csrf-token": "hello world",
      session: "abc",
    });
  });
});
