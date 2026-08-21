import { describe, expect, it } from "vitest";
import {
  createSecureCookie,
  parseCookieHeader,
  secureCookieName,
  validateSecureCookie,
} from "@demiurgejs/core";

describe("secure cookie serialization", () => {
  it("defaults a session cookie to the host prefix and safe attributes", () => {
    expect(
      createSecureCookie({
        name: "session",
        value: "alpha",
      }),
    ).toBe("__Host-session=alpha; Path=/; SameSite=Lax; HttpOnly; Secure");
  });

  it("keeps the declared lifetime and SameSite policy", () => {
    expect(
      createSecureCookie({
        expires: new Date("2030-01-01T00:00:00.000Z"),
        maxAge: 3600,
        name: "session",
        sameSite: "Strict",
        value: "alpha",
      }),
    ).toBe(
      "__Host-session=alpha; Path=/; Expires=Tue, 01 Jan 2030 00:00:00 GMT; Max-Age=3600; SameSite=Strict; HttpOnly; Secure",
    );
  });

  it("shares a secure-scoped cookie with subdomains", () => {
    expect(
      createSecureCookie({
        domain: "example.com",
        name: "tenant",
        path: "/app",
        scope: "secure",
        value: "beta",
      }),
    ).toBe(
      "__Secure-tenant=beta; Path=/app; Domain=example.com; SameSite=Lax; HttpOnly; Secure",
    );
  });

  it("encodes a value that a cookie header cannot hold", () => {
    const cookie = createSecureCookie({
      name: "session",
      value: "a b;c",
    });

    expect(cookie).toContain("__Host-session=a%20b%3Bc");
    expect(parseCookieHeader("__Host-session=a%20b%3Bc").get("__Host-session"))
      .toBe("a b;c");
  });

  it("allows the JavaScript-readable double-submit CSRF exception", () => {
    expect(
      createSecureCookie({
        httpOnly: false,
        name: "csrf-token",
        value: "token",
      }),
    ).toBe("__Host-csrf-token=token; Path=/; SameSite=Lax; Secure");
  });

  it("drops Secure only for an unprefixed cookie that opts out", () => {
    expect(
      createSecureCookie({
        name: "locale",
        scope: "none",
        secure: false,
        value: "en",
      }),
    ).toBe("locale=en; Path=/; SameSite=Lax; HttpOnly");
  });

  it("builds the prefixed name that a consumer reads back", () => {
    expect(secureCookieName("session")).toBe("__Host-session");
    expect(secureCookieName("tenant", "secure")).toBe("__Secure-tenant");
    expect(secureCookieName("locale", "none")).toBe("locale");
  });
});

describe("secure cookie invariants", () => {
  it("reports a prefixed scope that drops Secure", () => {
    expect(
      validateSecureCookie({
        name: "session",
        secure: false,
        value: "alpha",
      }),
    ).toEqual([
      {
        code: "cookie-scope-requires-secure",
        message:
          "Cookie __Host-session uses scope \"host\", so it requires Secure. Remove secure: false, or declare scope \"none\" for a cookie that a browser must accept over plain HTTP.",
        name: "__Host-session",
      },
    ]);
  });

  it("reports a host-scoped cookie that carries Domain or a narrow Path", () => {
    expect(
      validateSecureCookie({
        domain: "example.com",
        name: "session",
        path: "/app",
        value: "alpha",
      }).map((issue) => issue.code),
    ).toEqual(["cookie-domain-not-allowed", "cookie-path-not-allowed"]);
  });

  it("teaches the convention instead of renaming a prefixed cookie", () => {
    const issues = validateSecureCookie({
      name: "__Host-session",
      value: "alpha",
    });

    expect(issues.map((issue) => issue.code)).toEqual([
      "cookie-name-carries-prefix",
    ]);
    expect(issues[0]?.message).toContain("declare scope \"host\"");
  });

  it("reports a cookie name that a cookie header cannot hold", () => {
    expect(
      validateSecureCookie({
        name: "bad name",
        value: "alpha",
      }).map((issue) => issue.code),
    ).toEqual(["cookie-name-invalid"]);
  });

  it("reports SameSite=None without Secure", () => {
    expect(
      validateSecureCookie({
        name: "tenant",
        sameSite: "None",
        scope: "none",
        secure: false,
        value: "alpha",
      }).map((issue) => issue.code),
    ).toEqual(["cookie-same-site-none-requires-secure"]);
  });

  it("reports a Max-Age that is not a whole number of seconds", () => {
    expect(
      validateSecureCookie({
        maxAge: -1,
        name: "session",
        value: "alpha",
      }).map((issue) => issue.code),
    ).toEqual(["cookie-max-age-invalid"]);
  });

  it("reports a cookie that a browser drops for its size", () => {
    expect(
      validateSecureCookie({
        name: "session",
        value: "a".repeat(4096),
      }).map((issue) => issue.code),
    ).toEqual(["cookie-too-large"]);
  });

  it("accepts a valid declaration without an issue", () => {
    expect(
      validateSecureCookie({
        name: "session",
        path: "/",
        value: "alpha",
      }),
    ).toEqual([]);
  });

  it("throws for a JavaScript consumer that skips the type check", () => {
    expect(() =>
      createSecureCookie({
        domain: "example.com",
        name: "session",
        value: "alpha",
      }),
    ).toThrow(/Demiurge rejected a cookie declaration\./);
  });
});
