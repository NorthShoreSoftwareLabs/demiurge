import { describe, expect, it } from "vitest";
import { analytics } from "@demiurgejs/core";

describe("analytics integrations", () => {
  it("creates a consent-aware Plausible integration", () => {
    expect(analytics.plausible({ consent: "required", domain: "example.com" })).toEqual({
      consent: "required",
      domain: "example.com",
      kind: "analytics",
      needs: {
        connect: ["https://plausible.io"],
        script: ["https://plausible.io"],
      },
      provider: "plausible",
      scripts: [
        {
          dataApi: "https://plausible.io/api/event",
          dataDomain: "example.com",
          defer: true,
          kind: "script",
          needs: { connect: ["https://plausible.io"] },
          purpose: "analytics",
          src: "https://plausible.io/js/script.js",
          strategy: "afterInteractive",
        },
      ],
    });
  });

  it("supports HTTPS custom endpoints and supported script strategies", () => {
    const integration = analytics.plausible({
      domain: "example.com",
      endpoint: "https://analytics.example.com/",
      strategy: "beforeInteractive",
    });

    expect(integration.needs.connect).toEqual(["https://analytics.example.com"]);
    expect(integration.scripts[0]).toMatchObject({
      dataApi: "https://analytics.example.com/api/event",
      src: "https://analytics.example.com/js/script.js",
      strategy: "beforeInteractive",
    });
  });

  it("treats a path endpoint as a same-origin proxy", () => {
    const integration = analytics.plausible({
      domain: "example.com",
      endpoint: "/stats",
    });

    expect(integration.needs).toEqual({
      connect: ["'self'"],
      script: ["'self'"],
    });
    expect(integration.scripts[0]).toMatchObject({
      dataApi: "/stats/api/event",
      src: "/stats/js/script.js",
    });
  });

  it("rejects invalid domains and non-HTTPS endpoints", () => {
    expect(() => analytics.plausible({ domain: "example.com/path" })).toThrow(
      "Analytics domain must be a hostname without a path.",
    );
    expect(() => analytics.plausible({ domain: "example.com", endpoint: "http://localhost" })).toThrow(
      "Analytics endpoint must use HTTPS.",
    );
    expect(() => analytics.plausible({ domain: "example.com", endpoint: "//cdn" })).toThrow(
      "Analytics endpoint must not be a scheme-relative URL.",
    );
  });

  it("derives the Sentry loader script and ingest origin from the DSN", () => {
    const integration = analytics.sentry({
      dsn: "https://abc123@o42.ingest.sentry.io/4505",
    });

    expect(integration).toEqual({
      consent: false,
      ingestOrigin: "https://o42.ingest.sentry.io",
      kind: "analytics",
      needs: {
        connect: ["https://o42.ingest.sentry.io"],
        script: ["https://js.sentry-cdn.com"],
      },
      projectId: "4505",
      provider: "sentry",
      scripts: [
        {
          crossOrigin: "anonymous",
          kind: "script",
          needs: { connect: ["https://o42.ingest.sentry.io"] },
          purpose: "error-monitoring",
          src: "https://js.sentry-cdn.com/abc123.min.js",
          strategy: "beforeInteractive",
        },
      ],
    });
  });

  it("accepts a self-hosted Sentry loader host", () => {
    const integration = analytics.sentry({
      dsn: "https://abc123@sentry.example.com/7",
      loaderHost: "https://cdn.example.com/",
      strategy: "afterInteractive",
    });

    expect(integration.needs.script).toEqual(["https://cdn.example.com"]);
    expect(integration.scripts[0]).toMatchObject({
      src: "https://cdn.example.com/abc123.min.js",
      strategy: "afterInteractive",
    });
  });

  it("rejects a malformed Sentry DSN", () => {
    expect(() => analytics.sentry({ dsn: "http://abc@sentry.io/1" })).toThrow(
      "Sentry DSN must use HTTPS.",
    );
    expect(() => analytics.sentry({ dsn: "https://sentry.io/1" })).toThrow(
      "Sentry DSN must carry a public key and no secret key.",
    );
    expect(() => analytics.sentry({ dsn: "https://abc:secret@sentry.io/1" })).toThrow(
      "Sentry DSN must carry a public key and no secret key.",
    );
    expect(() => analytics.sentry({ dsn: "https://abc@sentry.io/" })).toThrow(
      "Sentry DSN must end with a project identifier.",
    );
  });

  it("describes an OpenTelemetry collector without a vendor script", () => {
    const integration = analytics.openTelemetry({
      endpoint: "https://collector.example.com/v1/traces",
    });

    expect(integration).toEqual({
      consent: false,
      endpoint: "https://collector.example.com",
      kind: "analytics",
      needs: { connect: ["https://collector.example.com"] },
      provider: "opentelemetry",
      scripts: [],
    });
  });

  it("carries an application-owned OpenTelemetry entry script", () => {
    const integration = analytics.openTelemetry({
      endpoint: "/telemetry",
      script: "/instrumentation.js",
    });

    expect(integration.needs).toEqual({
      connect: ["'self'"],
      script: ["'self'"],
    });
    expect(integration.scripts[0]).toMatchObject({
      needs: { connect: ["'self'"] },
      src: "/instrumentation.js",
      strategy: "module",
    });
  });

  it("rejects a cross-origin OpenTelemetry entry script", () => {
    expect(() =>
      analytics.openTelemetry({
        endpoint: "/telemetry",
        script: "https://cdn.example.com/otel.js",
      })
    ).toThrow(
      "OpenTelemetry browser instrumentation must be a same-origin script path.",
    );
  });

  it("merges the needs and script contributions of several integrations", () => {
    const plausible = analytics.plausible({ domain: "example.com" });
    const sentry = analytics.sentry({
      dsn: "https://abc123@o42.ingest.sentry.io/4505",
    });

    expect(analytics.policy(plausible, sentry)).toEqual({
      security: {
        needs: {
          connect: [
            "https://plausible.io",
            "https://o42.ingest.sentry.io",
          ],
          script: [
            "https://plausible.io",
            "https://js.sentry-cdn.com",
          ],
        },
      },
    });
    expect(analytics.scripts(plausible, sentry).map((entry) => entry.src)).toEqual([
      "https://plausible.io/js/script.js",
      "https://js.sentry-cdn.com/abc123.min.js",
    ]);
  });
});
