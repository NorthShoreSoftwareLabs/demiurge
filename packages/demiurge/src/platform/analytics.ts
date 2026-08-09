import { script, type ScriptTag } from "../document";

export type AnalyticsConsent = boolean | "required";

export type PlausibleAnalyticsOptions = {
  consent?: AnalyticsConsent;
  domain: string;
  endpoint?: string;
  strategy?: ScriptTag["strategy"];
};

export type PlausibleAnalytics = {
  connectSrc: string;
  consent: AnalyticsConsent;
  domain: string;
  kind: "analytics";
  provider: "plausible";
  script: ScriptTag;
};

export const analytics = {
  plausible(options: PlausibleAnalyticsOptions): PlausibleAnalytics {
    const domain = normalizeDomain(options.domain);
    const endpointUrl = parseEndpoint(options.endpoint ?? "https://plausible.io");

    return {
      connectSrc: endpointUrl.origin,
      consent: options.consent ?? false,
      domain,
      kind: "analytics",
      provider: "plausible",
      script: script({
        dataApi: `${endpointUrl.origin}/api/event`,
        dataDomain: domain,
        purpose: "analytics",
        src: `${endpointUrl.origin}/js/script.js`,
        strategy: options.strategy ?? "afterInteractive",
      }),
    };
  },
};

function normalizeDomain(domain: string) {
  const normalized = domain.trim();

  if (!normalized || normalized.includes("/") || normalized.includes(" ")) {
    throw new Error("Analytics domain must be a hostname without a path.");
  }

  return normalized;
}

function parseEndpoint(endpoint: string) {
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
