import { describe, expect, it } from "vitest";
import {
  COLLECTED_WEB_VITAL_NAMES,
  defineWebVitals,
  parseWebVitalsBeacon,
  readWebVitalsBeacon,
  WEB_VITAL_NAMES,
  webVitalRating,
  webVitalsPolicy,
  type WebVitalReport,
  type WebVitalSignal,
} from "@demiurgejs/core";

const report: WebVitalReport = {
  id: "LCP-1-2",
  name: "LCP",
  navigationType: "navigate",
  rating: "good",
  url: "https://example.com/",
  value: 1_200,
};

function beaconRequest(body: unknown) {
  return new Request("https://example.com/api/vitals", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    method: "POST",
  });
}

describe("defineWebVitals", () => {
  it("describes a same-origin endpoint with a 'self' connect need", () => {
    expect(defineWebVitals({ endpoint: "/api/vitals" })).toEqual({
      endpoint: "/api/vitals",
      kind: "web-vitals",
      metrics: COLLECTED_WEB_VITAL_NAMES,
      needs: { connect: ["'self'"] },
      sampleRate: 1,
    });
  });

  it("describes an HTTPS collector with its origin as the connect need", () => {
    const integration = defineWebVitals({
      endpoint: "https://collector.example.com/vitals",
      sampleRate: 0.25,
    });

    expect(integration.endpoint).toBe("https://collector.example.com/vitals");
    expect(integration.needs).toEqual({
      connect: ["https://collector.example.com"],
    });
    expect(integration.sampleRate).toBe(0.25);
  });

  it("keeps the requested metrics and removes a repeated name", () => {
    expect(
      defineWebVitals({ endpoint: "/v", metrics: ["LCP", "CLS", "LCP"] }).metrics,
    ).toEqual(["LCP", "CLS"]);
  });

  it("rejects an endpoint the browser cannot reach under a strict policy", () => {
    expect(() => defineWebVitals({ endpoint: "//cdn.example.com/v" })).toThrow(
      /scheme-relative/,
    );
    expect(() => defineWebVitals({ endpoint: "vitals" })).toThrow(
      /same-origin path or an absolute URL/,
    );
    expect(() => defineWebVitals({ endpoint: "http://example.com/v" })).toThrow(
      /HTTPS/,
    );
  });

  it("rejects a metric the browser collector does not measure", () => {
    expect(() => defineWebVitals({ endpoint: "/v", metrics: ["FID"] })).toThrow(
      /does not measure "FID"/,
    );
    expect(() => defineWebVitals({ endpoint: "/v", metrics: [] })).toThrow(
      /one metric or more/,
    );
  });

  it("rejects a sample rate outside the range 0 to 1", () => {
    expect(() => defineWebVitals({ endpoint: "/v", sampleRate: 1.5 })).toThrow(
      /between 0 and 1/,
    );
    expect(() => defineWebVitals({ endpoint: "/v", sampleRate: Number.NaN })).toThrow(
      /between 0 and 1/,
    );
  });
});

describe("webVitalsPolicy", () => {
  it("merges the connect needs of every integration", () => {
    expect(
      webVitalsPolicy(
        defineWebVitals({ endpoint: "/api/vitals" }),
        defineWebVitals({ endpoint: "https://collector.example.com/v" }),
        defineWebVitals({ endpoint: "/other" }),
      ),
    ).toEqual({
      security: {
        needs: { connect: ["'self'", "https://collector.example.com"] },
      },
    });
  });

  it("returns an empty need set for no integration", () => {
    expect(webVitalsPolicy()).toEqual({ security: { needs: {} } });
  });
});

describe("webVitalRating", () => {
  it("rates each metric against its published limits", () => {
    expect(webVitalRating("LCP", 2_500)).toBe("good");
    expect(webVitalRating("LCP", 3_000)).toBe("needs-improvement");
    expect(webVitalRating("LCP", 4_001)).toBe("poor");
    expect(webVitalRating("CLS", 0.05)).toBe("good");
    expect(webVitalRating("INP", 501)).toBe("poor");
    expect(webVitalRating("FID", 100)).toBe("good");
    expect(webVitalRating("FCP", 2_000)).toBe("needs-improvement");
    expect(webVitalRating("TTFB", 100)).toBe("good");
  });

  it("rates every name the contract publishes", () => {
    for (const name of WEB_VITAL_NAMES) {
      expect(webVitalRating(name, 0)).toBe("good");
    }
  });
});

describe("readWebVitalsBeacon", () => {
  it("accepts a valid beacon and returns typed reports", async () => {
    const result = await readWebVitalsBeacon(beaconRequest({ metrics: [report] }));

    expect(result).toEqual({ metrics: [report], ok: true });
  });

  it("returns a report that an instrumentation signal accepts", async () => {
    const result = await readWebVitalsBeacon(beaconRequest({ metrics: [report] }));

    if (!result.ok) {
      throw new Error("Expected a valid beacon.");
    }

    const signal: WebVitalSignal = result.metrics[0];

    expect(signal.name).toBe("LCP");
    expect(signal.value).toBe(1_200);
  });

  it("rejects a body that is not JSON", async () => {
    expect(await readWebVitalsBeacon(beaconRequest("not json"))).toEqual({
      ok: false,
      reason: "unreadable-body",
    });
  });

  it("rejects a beacon with more metrics than the limit", async () => {
    const result = await readWebVitalsBeacon(
      beaconRequest({ metrics: [report, report, report] }),
      { maxMetrics: 2 },
    );

    expect(result).toEqual({ ok: false, reason: "too-many-metrics" });
  });

  it("rejects a payload that carries no metric list", () => {
    expect(parseWebVitalsBeacon(null)).toEqual({
      ok: false,
      reason: "invalid-payload",
    });
    expect(parseWebVitalsBeacon({ metrics: "LCP" })).toEqual({
      ok: false,
      reason: "invalid-payload",
    });
  });

  it("rejects a report with a field outside the contract", () => {
    const invalid: unknown[] = [
      null,
      { ...report, id: "" },
      { ...report, id: "x".repeat(129) },
      { ...report, name: "SPEED" },
      { ...report, navigationType: "teleport" },
      { ...report, rating: "fine" },
      { ...report, url: "" },
      { ...report, url: "u".repeat(2_049) },
      { ...report, value: -1 },
      { ...report, value: Number.POSITIVE_INFINITY },
      { ...report, value: "1200" },
    ];

    for (const metric of invalid) {
      expect(parseWebVitalsBeacon({ metrics: [metric] })).toEqual({
        ok: false,
        reason: "invalid-payload",
      });
    }
  });
});
