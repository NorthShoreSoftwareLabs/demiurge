import { describe, expect, it } from "vitest";
import {
  createCorsHeaders,
  createMemoryRateLimitStore,
  createSecurityAudit,
  createSecurityHeaders,
  cspHash,
  defineRoutePolicy,
  defineSecurityPolicy,
  enforceAllowedMethods,
  enforceRateLimit,
  mergeRoutePolicies,
  mergeSecurityPolicies,
  parseCookieHeader,
  parseBodySize,
  parseRateLimitWindow,
  security,
  validateCorsPolicy,
  validateRateLimitPolicy,
} from "demiurge";

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

  it("renders Trusted Types headers in report-only and enforce modes", () => {
    const reportOnly = createSecurityHeaders({
      trustedTypes: {
        mode: "report-only",
        policies: ["demiurge", "dompurify"],
      },
    });
    const enforce = createSecurityHeaders({
      trustedTypes: {
        mode: "enforce",
        policies: ["demiurge"],
        requireFor: ["script"],
      },
    });

    expect(reportOnly.get("trusted-types-report-only")).toBe("demiurge dompurify");
    expect(reportOnly.has("trusted-types")).toBe(false);
    expect(enforce.get("trusted-types")).toBe("demiurge");
    expect(enforce.get("require-trusted-types-for")).toBe("'script'");
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
});

describe("security audit output", () => {
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

  it("omits CORS headers when the request has no allowed origin", () => {
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

    expect([...noOrigin]).toEqual([]);
    expect([...deniedOrigin]).toEqual([]);
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
    await expect(response?.text()).resolves.toBe("Rate limit exceeded.");
  });
});

describe("CSRF policy helpers", () => {
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
