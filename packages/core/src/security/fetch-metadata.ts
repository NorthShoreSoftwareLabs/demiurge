import type { HttpMethod } from "../route/types";
import type {
  FetchMetadataCheck,
  FetchMetadataPolicy,
  FetchMetadataPolicyOptions,
} from "./types";

// The canonical field names used in `Vary`. A shared cache compares field
// names without case, but a stable spelling keeps the header readable.
const destinationField = "Sec-Fetch-Dest";
const modeField = "Sec-Fetch-Mode";
const siteField = "Sec-Fetch-Site";

// A browser sets these destinations when one document embeds another one. A
// navigation allowance must not cover them, because an attacker page can
// frame the route and read the framed document through a side channel.
const embeddedDestinations = new Set(["embed", "object"]);

// Only a method that the browser can produce from a plain link or address bar
// counts as a safe top-level navigation.
const safeNavigationMethods = new Set<string>(["GET", "HEAD"]);

const defaultOptions: Required<
  Omit<FetchMetadataPolicyOptions, "allowedDestinations">
> = {
  allowCrossSite: false,
  allowNavigation: true,
  allowSameSite: false,
};

/**
 * Applies the MDN resource-isolation algorithm to one request.
 *
 * The check reads a Fetch Metadata header only when the decision needs it.
 * The returned `vary` list names exactly the fields that the decision read.
 */
export function checkFetchMetadata(
  policy: Exclude<FetchMetadataPolicy, false>,
  request: Request,
  method: HttpMethod | string = request.method,
): FetchMetadataCheck {
  const options = policy === true ? defaultOptions : { ...defaultOptions, ...policy };
  const vary: string[] = [];

  // A CORS preflight carries no application data and reads no route body. The
  // browser sends it before the request that the policy does judge.
  if (isCorsPreflight(request, method)) {
    return { allowed: true, reason: "cors-preflight", vary };
  }

  vary.push(siteField);
  const site = request.headers.get("sec-fetch-site");

  // A client that sends no Fetch Metadata stays compatible. MDN gives the
  // same guidance, because an old browser or a server-to-server client sends
  // no `Sec-Fetch-Site`.
  if (site === null) {
    return { allowed: true, reason: "metadata-absent", vary };
  }

  if (site === "same-origin") {
    return { allowed: true, reason: "same-origin", vary };
  }

  // `none` identifies a request that the user started, such as a bookmark or
  // an address bar entry.
  if (site === "none") {
    return { allowed: true, reason: "user-initiated", vary };
  }

  if (site === "same-site" && options.allowSameSite) {
    return { allowed: true, reason: "same-site-trusted", vary };
  }

  if (options.allowCrossSite) {
    return { allowed: true, reason: "cross-site-exempt", vary };
  }

  const allowedDestinations = policy === true
    ? undefined
    : policy.allowedDestinations;

  if (allowedDestinations?.length) {
    vary.push(destinationField);

    if (allowedDestinations.includes(request.headers.get("sec-fetch-dest") ?? "")) {
      return { allowed: true, reason: "destination-exempt", vary };
    }
  }

  if (options.allowNavigation && safeNavigationMethods.has(method.toUpperCase())) {
    vary.push(modeField);

    if (request.headers.get("sec-fetch-mode") === "navigate") {
      const destination = request.headers.get("sec-fetch-dest") ?? "";

      if (!vary.includes(destinationField)) {
        vary.push(destinationField);
      }

      if (!embeddedDestinations.has(destination)) {
        return { allowed: true, reason: "top-level-navigation", vary };
      }
    }
  }

  // An unknown `Sec-Fetch-Site` value is not one of the trusted values, so the
  // policy treats it the same way it treats a cross-site value.
  return {
    allowed: false,
    reason: site === "same-site" ? "same-site-denied" : "cross-site-denied",
    vary,
  };
}

export type FetchMetadataEnforcement = {
  response: Response | null;
  vary: readonly string[];
};

/**
 * Runs the policy before a route body runs.
 *
 * `response` holds a 403 response when the policy denies the request. `vary`
 * names the fields that every response for this route must declare, including
 * the responses that the route itself produces.
 */
export function enforceFetchMetadataPolicy(
  policy: FetchMetadataPolicy | undefined,
  request: Request,
  method: HttpMethod | string = request.method,
): FetchMetadataEnforcement {
  if (!policy) {
    return { response: null, vary: [] };
  }

  const check = checkFetchMetadata(policy, request, method);

  if (check.allowed) {
    return { response: null, vary: check.vary };
  }

  const response = new Response("Request blocked by the Fetch Metadata policy.", {
    headers: { "content-type": "text/plain; charset=utf-8" },
    status: 403,
  });
  applyFetchMetadataVary(response, check.vary);

  return { response, vary: check.vary };
}

/**
 * Adds the consulted Fetch Metadata fields to `Vary` without a duplicate.
 *
 * A shared cache must key on every field that changed the decision. The W3C
 * Fetch Metadata specification makes this requirement.
 */
export function applyFetchMetadataVary(
  response: Response,
  fields: readonly string[],
) {
  if (fields.length === 0) {
    return response;
  }

  const existing = response.headers.get("vary")
    ?.split(",")
    .map((field) => field.trim())
    .filter(Boolean) ?? [];

  // A wildcard already prevents every shared-cache reuse. Adding a field name
  // beside it would make the header weaker to read and no stronger.
  if (existing.includes("*")) {
    return response;
  }

  const merged = [...existing];

  for (const field of fields) {
    if (!merged.some((value) => value.toLowerCase() === field.toLowerCase())) {
      merged.push(field);
    }
  }

  response.headers.set("vary", merged.join(", "));

  return response;
}

function isCorsPreflight(request: Request, method: HttpMethod | string) {
  return (
    method.toUpperCase() === "OPTIONS" &&
    request.headers.has("access-control-request-method")
  );
}
