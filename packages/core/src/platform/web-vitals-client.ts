import { useEffect } from "react";
import type { WebVitalName } from "./observability";
import {
  webVitalRating,
  type WebVitalNavigationType,
  type WebVitalReport,
  type WebVitalsBeacon,
  type WebVitalsIntegration,
} from "./web-vitals";

export type WebVitalsTransport = (
  endpoint: string,
  beacon: WebVitalsBeacon,
) => void;

export type CollectWebVitalsOptions = {
  onReport?: (report: WebVitalReport) => void;
  random?: () => number;
  transport?: WebVitalsTransport;
};

export type WebVitalsProps = {
  integration: WebVitalsIntegration;
  onReport?: (report: WebVitalReport) => void;
  transport?: WebVitalsTransport;
};

// A layout shift stays in the current session window while it starts less than
// one second after the last shift. The window also ends five seconds after its
// first shift. The reported value is the largest window.
const sessionGapMs = 1_000;
const sessionWindowMs = 5_000;

// An interaction shorter than this cannot become the reported INP value, and
// the browser does not have to buffer it.
const interactionDurationThresholdMs = 40;

type LayoutShiftEntry = PerformanceEntry & {
  hadRecentInput: boolean;
  value: number;
};

type NavigationEntry = PerformanceEntry & {
  responseStart: number;
  type: string;
};

/**
 * Measures Core Web Vitals in the browser and posts them to the endpoint of
 * the integration. The collector uses `PerformanceObserver` only, so no inline
 * script and no vendor script is involved, and a strict policy needs no
 * `script-src` source for it.
 *
 * The returned function stops every observer and sends nothing more.
 */
export function collectWebVitals(
  integration: WebVitalsIntegration,
  options: CollectWebVitalsOptions = {},
): () => void {
  if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") {
    return () => undefined;
  }

  const random = options.random ?? Math.random;

  if (integration.sampleRate < 1 && random() >= integration.sampleRate) {
    return () => undefined;
  }

  const transport = options.transport ?? sendWebVitalsBeacon;
  const wanted = new Set(integration.metrics);
  const observers: PerformanceObserver[] = [];
  const pending: WebVitalReport[] = [];
  const reported = new Set<WebVitalName>();
  const navigationType = readNavigationType();
  let clsValue = 0;
  let sessionValue = 0;
  let sessionFirst = 0;
  let sessionLast = 0;
  let lcpValue: number | undefined;
  let inpValue: number | undefined;
  let stopped = false;

  const report = (name: WebVitalName, value: number) => {
    if (stopped || reported.has(name)) {
      return;
    }

    reported.add(name);

    const entry: WebVitalReport = {
      id: `${name}-${Date.now()}-${Math.floor(random() * 1_000_000_000)}`,
      name,
      navigationType,
      rating: webVitalRating(name, value),
      url: window.location.href,
      value: Math.round(value * 1_000) / 1_000,
    };

    pending.push(entry);
    options.onReport?.(entry);
  };

  const flush = () => {
    if (stopped) {
      return;
    }

    if (lcpValue !== undefined) {
      report("LCP", lcpValue);
    }

    if (inpValue !== undefined) {
      report("INP", inpValue);
    }

    if (wanted.has("CLS")) {
      report("CLS", clsValue);
    }

    if (pending.length === 0) {
      return;
    }

    const metrics = pending.splice(0, pending.length);

    transport(integration.endpoint, { metrics });
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      flush();
    }
  };

  if (wanted.has("TTFB")) {
    const navigation = readNavigationEntry();

    if (navigation && navigation.responseStart > 0) {
      report("TTFB", navigation.responseStart);
    }
  }

  if (wanted.has("FCP")) {
    observe(observers, { buffered: true, type: "paint" }, (entries) => {
      for (const entry of entries) {
        if (entry.name === "first-contentful-paint") {
          report("FCP", entry.startTime);
        }
      }
    });
  }

  if (wanted.has("LCP")) {
    observe(
      observers,
      { buffered: true, type: "largest-contentful-paint" },
      (entries) => {
        const last = entries.at(-1);

        if (last) {
          lcpValue = last.startTime;
        }
      },
    );
  }

  if (wanted.has("CLS")) {
    observe(observers, { buffered: true, type: "layout-shift" }, (entries) => {
      for (const shift of entries) {
        // TYPE-EVIDENCE: the observer subscribes to the layout-shift entry
        // type, so the browser delivers LayoutShift entries here. The cast
        // adds the two fields that lib.dom does not declare.
        const entry = shift as LayoutShiftEntry;

        if (entry.hadRecentInput) {
          continue;
        }

        const withinSession =
          sessionValue > 0 &&
          entry.startTime - sessionLast < sessionGapMs &&
          entry.startTime - sessionFirst < sessionWindowMs;

        if (withinSession) {
          sessionValue += entry.value;
        } else {
          sessionValue = entry.value;
          sessionFirst = entry.startTime;
        }

        sessionLast = entry.startTime;
        clsValue = Math.max(clsValue, sessionValue);
      }
    });
  }

  if (wanted.has("INP")) {
    observe(
      observers,
      {
        buffered: true,
        durationThreshold: interactionDurationThresholdMs,
        type: "event",
      },
      (entries) => {
        for (const entry of entries) {
          inpValue = Math.max(inpValue ?? 0, entry.duration);
        }
      },
    );
  }

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", flush);

  return () => {
    flush();
    stopped = true;

    for (const observer of observers) {
      observer.disconnect();
    }

    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pagehide", flush);
  };
}

/**
 * Starts the browser collector for the lifetime of the component. Put it in a
 * layout so that every page of the application reports.
 */
export function WebVitals({ integration, onReport, transport }: WebVitalsProps) {
  useEffect(
    () => collectWebVitals(integration, { onReport, transport }),
    [integration, onReport, transport],
  );

  return null;
}

/**
 * Posts one beacon. `navigator.sendBeacon` survives a page that unloads. When
 * the browser refuses the beacon, a `keepalive` fetch takes its place.
 */
export function sendWebVitalsBeacon(
  endpoint: string,
  beacon: WebVitalsBeacon,
): void {
  const body = JSON.stringify(beacon);

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([body], { type: "application/json" });

    if (navigator.sendBeacon(endpoint, blob)) {
      return;
    }
  }

  void fetch(endpoint, {
    body,
    headers: { "content-type": "application/json" },
    keepalive: true,
    method: "POST",
  }).catch(() => undefined);
}

// A browser that does not support an entry type throws on `observe`. The
// collector then reports the metrics it can measure instead of failing.
function observe(
  observers: PerformanceObserver[],
  init: PerformanceObserverInit & { durationThreshold?: number; type: string },
  handle: (entries: PerformanceEntryList) => void,
) {
  try {
    const observer = new PerformanceObserver((list) => handle(list.getEntries()));

    observer.observe(init);
    observers.push(observer);
  } catch {
    return;
  }
}

function readNavigationEntry(): NavigationEntry | undefined {
  if (typeof performance === "undefined") {
    return undefined;
  }

  // TYPE-EVIDENCE: the browser returns PerformanceNavigationTiming entries for
  // the navigation entry type. The cast adds the two fields this file reads.
  return performance.getEntriesByType("navigation")[0] as
    | NavigationEntry
    | undefined;
}

function readNavigationType(): WebVitalNavigationType {
  const navigation = readNavigationEntry();

  if (navigation?.type === "back_forward") {
    return "back-forward";
  }

  if (navigation?.type === "reload" || navigation?.type === "prerender") {
    return navigation.type;
  }

  return "navigate";
}
