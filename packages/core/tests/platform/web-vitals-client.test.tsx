// @vitest-environment jsdom

import { act } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectWebVitals,
  defineWebVitals,
  sendWebVitalsBeacon,
  WebVitals,
  type WebVitalsBeacon,
} from "@demiurgejs/core";

type ObserverInit = { durationThreshold?: number; type: string };

// The fields the collector reads from an entry. The fake observer is not a
// `PerformanceObserver`, so an entry needs no other field.
type FakeEntry = Record<string, unknown>;

type FakeCallback = (list: { getEntries: () => FakeEntry[] }) => void;

// jsdom implements no performance observer, so the tests install one that
// records each subscription and lets a test deliver entries on demand.
const subscriptions = new Map<string, (entries: FakeEntry[]) => void>();
const disconnected: string[] = [];
const unsupportedTypes = new Set<string>();

class FakePerformanceObserver {
  private type = "";

  constructor(private callback: FakeCallback) {}

  observe(init: ObserverInit) {
    if (unsupportedTypes.has(init.type)) {
      throw new TypeError(`Unsupported entry type ${init.type}.`);
    }

    this.type = init.type;
    subscriptions.set(init.type, (entries) => {
      this.callback({ getEntries: () => entries });
    });
  }

  disconnect() {
    disconnected.push(this.type);
  }
}

function deliver(type: string, entries: FakeEntry[]) {
  const subscription = subscriptions.get(type);

  if (!subscription) {
    throw new Error(`No observer subscribed to ${type}.`);
  }

  subscription(entries);
}

// A navigation entry reaches the collector through the real
// `performance.getEntriesByType`, so it carries the standard fields too.
function navigationEntry(responseStart: number, type: string) {
  const base: PerformanceEntry = {
    duration: 0,
    entryType: "navigation",
    name: "document",
    startTime: 0,
    toJSON: () => ({}),
  };

  return Object.assign(base, { responseStart, type });
}

function setNavigation(responseStart: number, type: string) {
  vi.spyOn(performance, "getEntriesByType").mockImplementation((entryType) =>
    entryType === "navigation" ? [navigationEntry(responseStart, type)] : [],
  );
}

const integration = defineWebVitals({ endpoint: "/api/vitals" });

beforeEach(() => {
  subscriptions.clear();
  disconnected.length = 0;
  unsupportedTypes.clear();
  vi.stubGlobal("PerformanceObserver", FakePerformanceObserver);
  setNavigation(120, "navigate");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("collectWebVitals", () => {
  it("reports every collected metric in one beacon when the page hides", () => {
    const beacons: WebVitalsBeacon[] = [];
    const stop = collectWebVitals(integration, {
      random: () => 0.5,
      transport: (_endpoint, beacon) => beacons.push(beacon),
    });

    deliver("paint", [{ name: "first-contentful-paint", startTime: 900 }]);
    deliver("largest-contentful-paint", [{ startTime: 1_500 }]);
    deliver("largest-contentful-paint", [{ startTime: 2_600 }]);
    deliver("event", [{ duration: 64 }, { duration: 240 }]);
    deliver("layout-shift", [
      { hadRecentInput: false, startTime: 100, value: 0.02 },
      { hadRecentInput: true, startTime: 200, value: 5 },
      { hadRecentInput: false, startTime: 500, value: 0.03 },
      { hadRecentInput: false, startTime: 9_000, value: 0.01 },
    ]);

    hidePage();

    expect(beacons).toHaveLength(1);

    const byName = new Map(
      beacons[0].metrics.map((metric) => [metric.name, metric]),
    );

    expect(byName.get("TTFB")).toMatchObject({ rating: "good", value: 120 });
    expect(byName.get("FCP")).toMatchObject({ rating: "good", value: 900 });
    expect(byName.get("LCP")).toMatchObject({
      navigationType: "navigate",
      rating: "needs-improvement",
      value: 2_600,
    });
    expect(byName.get("INP")).toMatchObject({
      rating: "needs-improvement",
      value: 240,
    });
    expect(byName.get("CLS")).toMatchObject({ rating: "good", value: 0.05 });

    for (const metric of beacons[0].metrics) {
      expect(metric.id).toContain(metric.name);
      expect(metric.url).toBe(window.location.href);
    }

    stop();
    expect(beacons).toHaveLength(1);
    expect(disconnected).toHaveLength(4);
  });

  it("sends nothing while the page stays visible", () => {
    const beacons: WebVitalsBeacon[] = [];

    collectWebVitals(integration, {
      random: () => 0.5,
      transport: (_endpoint, beacon) => beacons.push(beacon),
    });
    deliver("paint", [{ name: "first-contentful-paint", startTime: 900 }]);

    expect(beacons).toEqual([]);
  });

  it("posts the endpoint of the integration", () => {
    const endpoints: string[] = [];

    collectWebVitals(integration, {
      random: () => 0.5,
      transport: (endpoint) => endpoints.push(endpoint),
    });
    hidePage();

    expect(endpoints).toEqual(["/api/vitals"]);
  });

  it("reports only the metrics the integration selects", () => {
    const beacons: WebVitalsBeacon[] = [];

    collectWebVitals(defineWebVitals({ endpoint: "/v", metrics: ["TTFB"] }), {
      random: () => 0.5,
      transport: (_endpoint, beacon) => beacons.push(beacon),
    });
    expect(subscriptions.size).toBe(0);

    hidePage();

    expect(beacons[0].metrics.map((metric) => metric.name)).toEqual(["TTFB"]);
  });

  it("keeps the metrics it can measure when an entry type is unsupported", () => {
    const beacons: WebVitalsBeacon[] = [];

    unsupportedTypes.add("event");
    collectWebVitals(integration, {
      random: () => 0.5,
      transport: (_endpoint, beacon) => beacons.push(beacon),
    });
    deliver("paint", [{ name: "first-contentful-paint", startTime: 500 }]);
    hidePage();

    const names = beacons[0].metrics.map((metric) => metric.name);

    expect(names).toContain("FCP");
    expect(names).not.toContain("INP");
  });

  it("reads the navigation type of the document", () => {
    const beacons: WebVitalsBeacon[] = [];

    setNavigation(0, "back_forward");
    collectWebVitals(integration, {
      random: () => 0.5,
      transport: (_endpoint, beacon) => beacons.push(beacon),
    });
    deliver("paint", [{ name: "first-contentful-paint", startTime: 10 }]);
    hidePage();

    expect(beacons[0].metrics[0].navigationType).toBe("back-forward");
    expect(beacons[0].metrics.map((metric) => metric.name)).not.toContain("TTFB");
  });

  it("reports a reload as its own navigation type", () => {
    const beacons: WebVitalsBeacon[] = [];

    setNavigation(40, "reload");
    collectWebVitals(integration, {
      random: () => 0.5,
      transport: (_endpoint, beacon) => beacons.push(beacon),
    });
    hidePage();

    expect(beacons[0].metrics[0].navigationType).toBe("reload");
  });

  it("sends a final beacon when the collector stops", () => {
    const beacons: WebVitalsBeacon[] = [];
    const stop = collectWebVitals(integration, {
      random: () => 0.5,
      transport: (_endpoint, beacon) => beacons.push(beacon),
    });

    deliver("paint", [{ name: "first-contentful-paint", startTime: 600 }]);
    stop();

    expect(beacons).toHaveLength(1);
    expect(beacons[0].metrics.map((metric) => metric.name)).toContain("FCP");
  });

  it("collects nothing when the sample rate excludes the page load", () => {
    const onReport = vi.fn();
    const stop = collectWebVitals(
      defineWebVitals({ endpoint: "/v", sampleRate: 0.1 }),
      { onReport, random: () => 0.9 },
    );

    stop();

    expect(subscriptions.size).toBe(0);
    expect(onReport).not.toHaveBeenCalled();
  });

  it("collects when the sample rate includes the page load", () => {
    const onReport = vi.fn();

    collectWebVitals(defineWebVitals({ endpoint: "/v", sampleRate: 0.5 }), {
      onReport,
      random: () => 0.1,
    });
    deliver("paint", [{ name: "first-contentful-paint", startTime: 300 }]);

    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({ name: "FCP", value: 300 }),
    );
  });

  it("collects nothing without a performance observer", () => {
    vi.stubGlobal("PerformanceObserver", undefined);

    const stop = collectWebVitals(integration, { random: () => 0 });

    stop();

    expect(subscriptions.size).toBe(0);
  });
});

describe("sendWebVitalsBeacon", () => {
  const beacon: WebVitalsBeacon = {
    metrics: [
      {
        id: "LCP-1-2",
        name: "LCP",
        navigationType: "navigate",
        rating: "good",
        url: "https://example.com/",
        value: 900,
      },
    ],
  };

  it("prefers navigator.sendBeacon", () => {
    const send = vi.fn((_url: string, _body?: BodyInit) => true);

    vi.stubGlobal("navigator", { sendBeacon: send });
    sendWebVitalsBeacon("/api/vitals", beacon);

    expect(send).toHaveBeenCalledTimes(1);
    const body = send.mock.calls[0][1];

    expect(send.mock.calls[0][0]).toBe("/api/vitals");
    expect(body).toBeInstanceOf(Blob);
    expect(body instanceof Blob ? body.type : undefined).toBe("application/json");
  });

  it("falls back to a keepalive fetch when the browser refuses the beacon", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 202 }),
    );

    vi.stubGlobal("navigator", { sendBeacon: () => false });
    vi.stubGlobal("fetch", fetchMock);
    sendWebVitalsBeacon("/api/vitals", beacon);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const init = fetchMock.mock.calls[0][1];

    expect(init?.method).toBe("POST");
    expect(init?.keepalive).toBe(true);
    expect(init?.body).toBe(JSON.stringify(beacon));
  });

  it("ignores a rejected fallback fetch", async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => {
      throw new Error("offline");
    });

    vi.stubGlobal("navigator", {});
    vi.stubGlobal("fetch", fetchMock);

    expect(() => sendWebVitalsBeacon("/api/vitals", beacon)).not.toThrow();
    await Promise.resolve();
  });
});

describe("WebVitals component", () => {
  it("collects for the lifetime of the component and renders nothing", () => {
    const beacons: WebVitalsBeacon[] = [];
    const container = document.createElement("div");

    document.body.append(container);

    const root = createRoot(container);

    act(() => {
      root.render(
        <WebVitals
          integration={integration}
          transport={(_endpoint, beacon) => beacons.push(beacon)}
        />,
      );
    });

    expect(container.innerHTML).toBe("");

    deliver("paint", [{ name: "first-contentful-paint", startTime: 700 }]);

    act(() => {
      root.unmount();
    });

    expect(beacons).toHaveLength(1);
    expect(beacons[0].metrics.map((metric) => metric.name)).toContain("FCP");

    container.remove();
  });
});

function hidePage() {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
}
