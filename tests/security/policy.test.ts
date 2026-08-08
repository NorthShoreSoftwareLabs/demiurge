import { describe, expect, it } from "vitest";
import { createSecurityHeaders, security } from "demiurge";

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
      "img-src 'self' https://images.example.com",
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
});
