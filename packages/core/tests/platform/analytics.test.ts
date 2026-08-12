import { describe, expect, it } from "vitest";
import { analytics } from "@demiurge-js/core";

describe("analytics integrations", () => {
  it("creates a consent-aware Plausible script descriptor", () => {
    expect(analytics.plausible({ consent: "required", domain: "example.com" })).toEqual({
      connectSrc: "https://plausible.io",
      consent: "required",
      domain: "example.com",
      kind: "analytics",
      provider: "plausible",
      script: {
        dataApi: "https://plausible.io/api/event",
        dataDomain: "example.com",
        kind: "script",
        purpose: "analytics",
        src: "https://plausible.io/js/script.js",
        strategy: "afterInteractive",
      },
    });
  });

  it("supports HTTPS custom endpoints and supported script strategies", () => {
    const integration = analytics.plausible({
      domain: "example.com",
      endpoint: "https://analytics.example.com/",
      strategy: "beforeInteractive",
    });

    expect(integration.connectSrc).toBe("https://analytics.example.com");
    expect(integration.script).toMatchObject({
      dataApi: "https://analytics.example.com/api/event",
      src: "https://analytics.example.com/js/script.js",
      strategy: "beforeInteractive",
    });
  });

  it("rejects invalid domains and non-HTTPS endpoints", () => {
    expect(() => analytics.plausible({ domain: "example.com/path" })).toThrow(
      "Analytics domain must be a hostname without a path.",
    );
    expect(() => analytics.plausible({ domain: "example.com", endpoint: "http://localhost" })).toThrow(
      "Analytics endpoint must use HTTPS.",
    );
  });
});
