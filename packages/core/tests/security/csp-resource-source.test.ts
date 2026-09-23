import { describe, expect, it } from "vitest";
import {
  cspScriptSourceListAllowsResource,
  cspSourceListAllowsResource,
} from "../../src/security/csp-source";

describe("CSP resource source matching", () => {
  it.each([
    ["https:", "https://cdn.example.com/app.js", true],
    ["http:", "https://cdn.example.com/app.js", true],
    ["https:", "http://cdn.example.com/app.js", false],
    ["https://cdn.example.com", "https://cdn.example.com/app.js", true],
    ["https://cdn.example.com", "https://cdn.example.com:8443/app.js", false],
    ["https://cdn.example.com:*", "https://cdn.example.com:8443/app.js", true],
    ["https://*.example.com", "https://a.b.example.com/app.js", true],
    ["https://*.example.com", "https://example.com/app.js", false],
    ["https://*.example.com", "https://evil-example.com/app.js", false],
    ["https://cdn.example.com/app.js", "https://cdn.example.com/app.js", true],
    ["https://cdn.example.com/app.js", "https://cdn.example.com/app.js.evil", false],
    ["https://cdn.example.com/assets/", "https://cdn.example.com/assets/app.js", true],
    ["https://cdn.example.com/assets/", "https://cdn.example.com/asset/app.js", false],
    ["https://cdn.example.com/app.js", "https://cdn.example.com/app.js?version=1", true],
    ["https://cdn.example.com/app%2Ejs", "https://cdn.example.com/app.js", true],
  ])("matches source %s against resource %s", (source, resource, allowed) => {
    expect(cspSourceListAllowsResource([source], resource)).toBe(allowed);
  });

  it("matches a scheme-less host against the protected origin scheme", () => {
    expect(
      cspSourceListAllowsResource(
        ["cdn.example.com"],
        "https://cdn.example.com/app.js",
        "http://app.example.com",
      ),
    ).toBe(true);
  });

  it("matches a scheme-less host when the resource supplies an HTTP scheme", () => {
    expect(
      cspSourceListAllowsResource(
        ["cdn.example.com"],
        "https://cdn.example.com/app.js",
      ),
    ).toBe(true);
  });

  it("matches self against the protected origin", () => {
    expect(
      cspSourceListAllowsResource(
        ["'self'"],
        "https://app.example.com/app.js",
        "https://app.example.com",
      ),
    ).toBe(true);
    expect(
      cspSourceListAllowsResource(
        ["'self'"],
        "https://cdn.example.com/app.js",
        "https://app.example.com",
      ),
    ).toBe(false);
  });

  it.each(["app.js", "./app.js", "../app.js", "/app.js"])(
    "matches relative resource %s against self",
    (resource) => {
      expect(cspSourceListAllowsResource(["'self'"], resource)).toBe(true);
    },
  );

  it("keeps host sources active beside a nonce source", () => {
    expect(
      cspSourceListAllowsResource(
        ["'nonce-example'", "https://cdn.example.com"],
        "https://cdn.example.com/app.css",
      ),
    ).toBe(true);
  });

  it("ignores script host sources when strict-dynamic is active", () => {
    expect(
      cspScriptSourceListAllowsResource(
        ["'nonce-example'", "'strict-dynamic'", "https://cdn.example.com"],
        "https://cdn.example.com/app.js",
      ),
    ).toBe(false);
  });
});
