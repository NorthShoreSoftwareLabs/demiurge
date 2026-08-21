import { script, type ScriptTag } from "../document";
import type { CspSource, RoutePolicy, RouteSecurityNeeds } from "../security/types";

export type AnalyticsConsent = boolean | "required";

export type AnalyticsProvider = "opentelemetry" | "plausible" | "sentry";

/**
 * An integration descriptor. `scripts` goes into `export const scripts` and
 * `needs` goes into the route policy. The build compares the two, so wiring
 * only one half fails with a diagnostic that names the missing directive.
 */
export type AnalyticsIntegration = {
  consent: AnalyticsConsent;
  kind: "analytics";
  needs: RouteSecurityNeeds;
  provider: AnalyticsProvider;
  scripts: readonly ScriptTag[];
};

export type PlausibleAnalyticsOptions = {
  consent?: AnalyticsConsent;
  domain: string;
  endpoint?: string;
  strategy?: ScriptTag["strategy"];
};

export type PlausibleAnalytics = AnalyticsIntegration & {
  domain: string;
  provider: "plausible";
};

export type SentryAnalyticsOptions = {
  consent?: AnalyticsConsent;
  dsn: string;
  loaderHost?: string;
  strategy?: ScriptTag["strategy"];
};

export type SentryAnalytics = AnalyticsIntegration & {
  ingestOrigin: string;
  projectId: string;
  provider: "sentry";
};

export type OpenTelemetryAnalyticsOptions = {
  consent?: AnalyticsConsent;
  endpoint: string;
  script?: string;
  strategy?: ScriptTag["strategy"];
};

export type OpenTelemetryAnalytics = AnalyticsIntegration & {
  endpoint: string;
  provider: "opentelemetry";
};

const sentryLoaderHost = "https://js.sentry-cdn.com";

export const analytics = {
  /**
   * Plausible loads one script and posts events to its own API. The snippet
   * carries configuration in `data-domain`, so no inline code is involved.
   * `endpoint` accepts a same-origin path prefix for a proxied deployment.
   */
  plausible(options: PlausibleAnalyticsOptions): PlausibleAnalytics {
    const domain = normalizeDomain(options.domain);
    const endpoint = parseEndpoint(options.endpoint ?? "https://plausible.io");

    return {
      consent: options.consent ?? false,
      domain,
      kind: "analytics",
      needs: {
        connect: [endpoint.source],
        script: [endpoint.source],
      },
      provider: "plausible",
      scripts: [
        script({
          dataApi: `${endpoint.base}/api/event`,
          dataDomain: domain,
          defer: true,
          needs: { connect: [endpoint.source] },
          purpose: "analytics",
          src: `${endpoint.base}/js/script.js`,
          strategy: options.strategy ?? "afterInteractive",
        }),
      ],
    };
  },
  /**
   * The Sentry loader script carries the DSN in its own filename, so a page
   * needs no inline configuration call. Events go to the DSN host, which is
   * why the integration also declares a `connect-src` need.
   */
  sentry(options: SentryAnalyticsOptions): SentryAnalytics {
    const dsn = parseSentryDsn(options.dsn);
    const loader = parseHttpsOrigin(
      options.loaderHost ?? sentryLoaderHost,
      "Sentry loader host",
    );

    return {
      consent: options.consent ?? false,
      ingestOrigin: dsn.origin,
      kind: "analytics",
      needs: {
        connect: [dsn.origin],
        script: [loader],
      },
      projectId: dsn.projectId,
      provider: "sentry",
      scripts: [
        script({
          crossOrigin: "anonymous",
          needs: { connect: [dsn.origin] },
          purpose: "error-monitoring",
          src: `${loader}/${dsn.publicKey}.min.js`,
          // Errors thrown before the app is interactive are the ones an
          // application can least afford to lose.
          strategy: options.strategy ?? "beforeInteractive",
        }),
      ],
    };
  },
  /**
   * OpenTelemetry publishes no hosted browser loader. Browser instrumentation
   * is application code bundled from npm packages, so this helper describes
   * the part a policy has to know about: the OTLP endpoint the exporter posts
   * to, and an optional same-origin entry script that starts the SDK.
   */
  openTelemetry(
    options: OpenTelemetryAnalyticsOptions,
  ): OpenTelemetryAnalytics {
    const endpoint = parseEndpoint(options.endpoint);
    const entry = options.script;

    if (entry !== undefined && !entry.startsWith("/")) {
      throw new Error(
        "OpenTelemetry browser instrumentation must be a same-origin script path.",
      );
    }

    return {
      consent: options.consent ?? false,
      endpoint: endpoint.base || "/",
      kind: "analytics",
      needs: entry
        ? { connect: [endpoint.source], script: ["'self'"] }
        : { connect: [endpoint.source] },
      provider: "opentelemetry",
      scripts: entry
        ? [
          script({
            needs: { connect: [endpoint.source] },
            purpose: "observability",
            src: entry,
            strategy: options.strategy ?? "module",
          }),
        ]
        : [],
    };
  },
  /** Merges the CSP needs of every integration into one route policy. */
  policy(...integrations: readonly AnalyticsIntegration[]): RoutePolicy {
    const needs: { -readonly [Key in keyof RouteSecurityNeeds]: CspSource[] } =
      {};

    for (const integration of integrations) {
      for (const need of ["connect", "img", "script"] as const) {
        const sources = integration.needs[need];

        if (!sources || sources.length === 0) {
          continue;
        }

        needs[need] = [...new Set([...(needs[need] ?? []), ...sources])];
      }
    }

    return { security: { needs } };
  },
  /** Collects the script contributions of every integration. */
  scripts(...integrations: readonly AnalyticsIntegration[]): ScriptTag[] {
    return integrations.flatMap((integration) => [...integration.scripts]);
  },
};

function normalizeDomain(domain: string) {
  const normalized = domain.trim();

  if (!normalized || normalized.includes("/") || normalized.includes(" ")) {
    throw new Error("Analytics domain must be a hostname without a path.");
  }

  return normalized;
}

// An endpoint is either a vendor origin or a same-origin path prefix. A proxied
// deployment serves the vendor through the application origin, which `'self'`
// already covers, so the returned CSP source differs in that case.
function parseEndpoint(endpoint: string) {
  if (endpoint.startsWith("/")) {
    if (endpoint.startsWith("//")) {
      throw new Error("Analytics endpoint must not be a scheme-relative URL.");
    }

    // TYPE-EVIDENCE: the self string literal is a valid CSP source keyword. The cast labels it as the CspSource type.
    return {
      base: endpoint === "/" ? "" : endpoint.replace(/\/+$/, ""),
      source: "'self'" as CspSource,
    };
  }

  const url = parseAbsoluteEndpoint(endpoint);

  // TYPE-EVIDENCE: the parsed URL origin is a valid same-origin CSP source string. The cast labels it as the CspSource type.
  return { base: url.origin, source: url.origin as CspSource };
}

function parseAbsoluteEndpoint(endpoint: string) {
  let url: URL;

  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Analytics endpoint must be an absolute URL.");
  }

  if (url.protocol !== "https:") {
    throw new Error("Analytics endpoint must use HTTPS.");
  }

  return url;
}

function parseHttpsOrigin(value: string, label: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL.`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS.`);
  }

  return url.origin;
}

// A Sentry DSN is https://<publicKey>@<host>/<projectId>. Every part the
// browser needs comes from it, so an application configures one value.
function parseSentryDsn(dsn: string) {
  let url: URL;

  try {
    url = new URL(dsn);
  } catch {
    throw new Error("Sentry DSN must be an absolute URL.");
  }

  if (url.protocol !== "https:") {
    throw new Error("Sentry DSN must use HTTPS.");
  }

  const projectId = url.pathname.replace(/^\//, "");

  if (!url.username || url.password) {
    throw new Error(
      "Sentry DSN must carry a public key and no secret key.",
    );
  }

  if (!/^[A-Za-z0-9_-]+$/.test(projectId)) {
    throw new Error("Sentry DSN must end with a project identifier.");
  }

  return {
    origin: url.origin,
    projectId,
    publicKey: url.username,
  };
}
