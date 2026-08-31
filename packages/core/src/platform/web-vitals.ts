import type { CspSource, RoutePolicy, RouteSecurityNeeds } from "../security/types";
import type { WebVitalName, WebVitalRating } from "./observability";
import { isObjectLike } from "../type-guards";

export const WEB_VITAL_NAMES: readonly WebVitalName[] = [
  "CLS",
  "FCP",
  "FID",
  "INP",
  "LCP",
  "TTFB",
];

/** The metrics the browser collector measures without a vendor script. */
export const COLLECTED_WEB_VITAL_NAMES: readonly WebVitalName[] = [
  "CLS",
  "FCP",
  "INP",
  "LCP",
  "TTFB",
];

export type WebVitalNavigationType =
  | "back-forward"
  | "back-forward-cache"
  | "navigate"
  | "prerender"
  | "reload"
  | "restore";

// Each set is read as a set of plain strings, so a guard narrows an unknown
// value without a type assertion.
const METRIC_NAMES: ReadonlySet<string> = new Set(WEB_VITAL_NAMES);

const NAVIGATION_TYPES: ReadonlySet<string> = new Set<WebVitalNavigationType>([
  "back-forward",
  "back-forward-cache",
  "navigate",
  "prerender",
  "reload",
  "restore",
]);

const RATINGS: ReadonlySet<string> = new Set<WebVitalRating>([
  "good",
  "needs-improvement",
  "poor",
]);

function isWebVitalName(value: unknown): value is WebVitalName {
  return typeof value === "string" && METRIC_NAMES.has(value);
}

function isNavigationType(value: unknown): value is WebVitalNavigationType {
  return typeof value === "string" && NAVIGATION_TYPES.has(value);
}

function isRating(value: unknown): value is WebVitalRating {
  return typeof value === "string" && RATINGS.has(value);
}

/**
 * One measurement of one metric. The shape is also a `WebVitalSignal`, so an
 * application can pass a report straight to `instrumentation.reportWebVitals`.
 */
export type WebVitalReport = {
  id: string;
  name: WebVitalName;
  navigationType: WebVitalNavigationType;
  rating: WebVitalRating;
  url: string;
  value: number;
};

/** The body the browser collector posts to the application endpoint. */
export type WebVitalsBeacon = {
  metrics: readonly WebVitalReport[];
};

export type WebVitalsOptions = {
  endpoint: string;
  metrics?: readonly WebVitalName[];
  sampleRate?: number;
};

/**
 * An integration descriptor. `needs` goes into the route policy and the rest
 * configures the browser collector. The application owns the endpoint route,
 * so the framework sends no measurement to a third party.
 */
export type WebVitalsIntegration = {
  endpoint: string;
  kind: "web-vitals";
  metrics: readonly WebVitalName[];
  needs: RouteSecurityNeeds;
  sampleRate: number;
};

/**
 * The published good and poor limits for each metric. A value at the good
 * limit or below rates `good`. A value above the poor limit rates `poor`.
 * See https://web.dev/articles/defining-core-web-vitals-thresholds.
 */
export const WEB_VITAL_THRESHOLDS: Readonly<
  Record<WebVitalName, { good: number; poor: number }>
> = {
  CLS: { good: 0.1, poor: 0.25 },
  FCP: { good: 1_800, poor: 3_000 },
  FID: { good: 100, poor: 300 },
  INP: { good: 200, poor: 500 },
  LCP: { good: 2_500, poor: 4_000 },
  TTFB: { good: 800, poor: 1_800 },
};

/** Rates one measurement against the published limits for its metric. */
export function webVitalRating(
  name: WebVitalName,
  value: number,
): WebVitalRating {
  const threshold = WEB_VITAL_THRESHOLDS[name];

  if (value <= threshold.good) {
    return "good";
  }

  return value > threshold.poor ? "poor" : "needs-improvement";
}

export type WebVitalsBeaconResult =
  | { ok: true; metrics: readonly WebVitalReport[] }
  | { ok: false; reason: WebVitalsBeaconRejection };

export type WebVitalsBeaconRejection =
  | "invalid-payload"
  | "too-many-metrics"
  | "unreadable-body";

export type ReadWebVitalsBeaconOptions = {
  maxMetrics?: number;
};

const defaultMaxMetrics = 32;

/**
 * Describes the beacon endpoint and the metrics to collect. The endpoint is a
 * same-origin path or an HTTPS URL. A same-origin path needs `'self'` in
 * `connect-src`, which `webVitalsPolicy` contributes.
 */
export function defineWebVitals(options: WebVitalsOptions): WebVitalsIntegration {
  const endpoint = parseBeaconEndpoint(options.endpoint);
  const metrics = parseMetricNames(options.metrics);
  const sampleRate = parseSampleRate(options.sampleRate);

  return {
    endpoint: endpoint.url,
    kind: "web-vitals",
    metrics,
    needs: { connect: [endpoint.source] },
    sampleRate,
  };
}

/** Merges the CSP needs of every integration into one route policy. */
export function webVitalsPolicy(
  ...integrations: readonly WebVitalsIntegration[]
): RoutePolicy {
  const connect = new Set<CspSource>();

  for (const integration of integrations) {
    for (const source of integration.needs.connect ?? []) {
      connect.add(source);
    }
  }

  if (connect.size === 0) {
    return { security: { needs: {} } };
  }

  return { security: { needs: { connect: [...connect] } } };
}

/**
 * Reads and validates a beacon body on the server. The result carries only
 * reports that match the contract, so a handler never forwards unchecked
 * browser input to a metrics backend.
 */
export async function readWebVitalsBeacon(
  request: Request,
  options: ReadWebVitalsBeaconOptions = {},
): Promise<WebVitalsBeaconResult> {
  const maxMetrics = options.maxMetrics ?? defaultMaxMetrics;
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return { ok: false, reason: "unreadable-body" };
  }

  return parseWebVitalsBeacon(payload, maxMetrics);
}

/** The synchronous half of `readWebVitalsBeacon`, for an already parsed body. */
export function parseWebVitalsBeacon(
  payload: unknown,
  maxMetrics: number = defaultMaxMetrics,
): WebVitalsBeaconResult {
  if (!isObjectLike(payload) || !Array.isArray(payload.metrics)) {
    return { ok: false, reason: "invalid-payload" };
  }

  if (payload.metrics.length > maxMetrics) {
    return { ok: false, reason: "too-many-metrics" };
  }

  const metrics: WebVitalReport[] = [];

  for (const entry of payload.metrics) {
    const report = parseWebVitalReport(entry);

    if (!report) {
      return { ok: false, reason: "invalid-payload" };
    }

    metrics.push(report);
  }

  return { metrics, ok: true };
}

function parseWebVitalReport(entry: unknown): WebVitalReport | undefined {
  if (!isObjectLike(entry)) {
    return undefined;
  }

  const { id, name, navigationType, rating, url, value } = entry;

  if (typeof id !== "string" || id.length === 0 || id.length > 128) {
    return undefined;
  }

  if (!isWebVitalName(name) || !isNavigationType(navigationType)) {
    return undefined;
  }

  if (!isRating(rating)) {
    return undefined;
  }

  if (typeof url !== "string" || url.length === 0 || url.length > 2048) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return { id, name, navigationType, rating, url, value };
}

// The endpoint is either a same-origin path or an HTTPS collector URL. A
// same-origin path is already covered by `'self'`, so the CSP source differs.
function parseBeaconEndpoint(
  endpoint: string,
): { source: CspSource; url: string } {
  if (endpoint.startsWith("/")) {
    if (endpoint.startsWith("//")) {
      throw new Error(
        "The web vitals endpoint must not be a scheme-relative URL.",
      );
    }

    return { source: "'self'", url: endpoint };
  }

  let url: URL;

  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(
      "The web vitals endpoint must be a same-origin path or an absolute URL.",
    );
  }

  if (url.protocol !== "https:") {
    throw new Error("The web vitals endpoint must use HTTPS.");
  }

  return { source: url.origin, url: url.href };
}

function parseMetricNames(metrics: readonly WebVitalName[] | undefined) {
  if (!metrics) {
    return COLLECTED_WEB_VITAL_NAMES;
  }

  const selected: WebVitalName[] = [];

  for (const metric of metrics) {
    if (!COLLECTED_WEB_VITAL_NAMES.includes(metric)) {
      throw new Error(
        `The browser collector does not measure ${JSON.stringify(metric)}. Demiurge collects ${COLLECTED_WEB_VITAL_NAMES.join(", ")}.`,
      );
    }

    if (!selected.includes(metric)) {
      selected.push(metric);
    }
  }

  if (selected.length === 0) {
    throw new Error("A web vitals integration must collect one metric or more.");
  }

  return selected;
}

function parseSampleRate(sampleRate: number | undefined) {
  if (sampleRate === undefined) {
    return 1;
  }

  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) {
    throw new Error("The web vitals sample rate must be between 0 and 1.");
  }

  return sampleRate;
}
