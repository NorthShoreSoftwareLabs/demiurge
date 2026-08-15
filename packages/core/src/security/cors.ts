import type { HttpMethod, ResponseCapability, RouteModule } from "../route/types";
import type {
  CorsPolicy,
  CorsRequestContext,
  CorsResponseOptions,
} from "./types";

export function createCorsHeaders(
  policy: CorsPolicy,
  context: CorsRequestContext,
  options: CorsResponseOptions = {},
) {
  validateCorsPolicy(policy);

  const origin = context.request.headers.get("origin");
  const headers = new Headers();

  // An allowlist makes the representation depend on the origin. This rule also
  // applies when the request has no Origin header or has a denied origin. Each
  // branch must contain the Vary field. Otherwise, a shared cache can reuse a
  // response for the wrong origin.
  if (policy.origins !== "*") {
    appendVary(headers, "Origin");
  }

  if (!origin) {
    return headers;
  }

  const allowedOrigin = resolveAllowedOrigin(policy, origin);

  if (!allowedOrigin) {
    return headers;
  }

  headers.set("access-control-allow-origin", allowedOrigin);

  if (policy.credentials) {
    headers.set("access-control-allow-credentials", "true");
  }

  if (policy.exposeHeaders?.length) {
    headers.set("access-control-expose-headers", policy.exposeHeaders.join(", "));
  }

  if (options.preflight) {
    headers.set("access-control-allow-methods", options.methods.join(", "));

    const requestedHeaders = context.request.headers.get(
      "access-control-request-headers",
    );
    const allowedHeaders = policy.headers?.join(", ") ?? requestedHeaders;

    if (allowedHeaders) {
      headers.set("access-control-allow-headers", allowedHeaders);
    }

    if (policy.maxAge !== undefined) {
      headers.set("access-control-max-age", String(policy.maxAge));
    }
  }

  return headers;
}

export function applyCorsHeaders(
  response: Response,
  policy: CorsPolicy | undefined,
  request: Request,
) {
  if (!policy) {
    return response;
  }

  const headers = new Headers(response.headers);
  mergeHeaders(headers, createCorsHeaders(policy, { request }));

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export function createCorsPreflightResponse(
  routeModule: RouteModule,
  request: Request,
) {
  const requestedMethod = request.headers.get("access-control-request-method");
  const method = normalizeCorsMethod(requestedMethod);

  if (!method) {
    return null;
  }

  const capability = getMethodCapability(routeModule, method);

  if (!capability?.cors) {
    return null;
  }

  const methods = capability.cors.methods ?? allowedCorsMethods(routeModule);

  if (!methods.includes(method)) {
    return null;
  }

  return new Response(null, {
    headers: createCorsHeaders(
      capability.cors,
      { request },
      {
        methods,
        preflight: true,
      },
    ),
    status: 204,
  });
}

export function validateCorsPolicy(policy: CorsPolicy) {
  if (policy.credentials && policy.origins === "*") {
    throw new Error(
      "Demiurge CORS policy cannot use wildcard origins with credentials.",
    );
  }

  if (
    policy.credentials &&
    (policy.headers?.includes("*") || policy.exposeHeaders?.includes("*"))
  ) {
    throw new Error(
      "Demiurge credentialed CORS policy must list allowed and exposed headers explicitly.",
    );
  }

  if (policy.origins !== "*") {
    for (const origin of policy.origins) {
      validateCorsOrigin(origin);
    }
  }

  if (
    policy.maxAge !== undefined &&
    (!Number.isSafeInteger(policy.maxAge) || policy.maxAge < 0)
  ) {
    throw new Error(
      "Demiurge CORS maxAge must be a non-negative integer number of seconds.",
    );
  }
}

function validateCorsOrigin(origin: string) {
  let parsed: URL;

  try {
    parsed = new URL(origin);
  } catch {
    throw invalidCorsOrigin(origin);
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.origin !== origin
  ) {
    throw invalidCorsOrigin(origin);
  }
}

function invalidCorsOrigin(origin: string) {
  return new Error(
    `Demiurge CORS origin ${JSON.stringify(origin)} must be a canonical HTTP(S) origin without credentials, a path, query, or fragment.`,
  );
}

function resolveAllowedOrigin(policy: CorsPolicy, origin: string) {
  if (policy.origins === "*") {
    return "*";
  }

  return policy.origins.includes(origin) ? origin : null;
}

function mergeHeaders(target: Headers, source: Headers) {
  source.forEach((value, name) => {
    if (name === "vary" && target.has("vary")) {
      for (const field of value.split(",")) {
        appendVary(target, field.trim());
      }
      return;
    }

    target.set(name, value);
  });
}

function appendVary(headers: Headers, field: string) {
  if (!field) {
    return;
  }

  const existing = headers.get("vary")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean) ?? [];

  if (existing.some((value) => value.toLowerCase() === field.toLowerCase())) {
    return;
  }

  headers.set("vary", [...existing, field].join(", "));
}

function normalizeCorsMethod(method: string | null): HttpMethod | null {
  if (!method) {
    return null;
  }

  const upperMethod = method.toUpperCase();
  return isHttpMethod(upperMethod) ? upperMethod : null;
}

function getMethodCapability(
  routeModule: RouteModule,
  method: HttpMethod,
): ResponseCapability | undefined {
  if (method === "HEAD") {
    return routeModule.HEAD ?? responseCapability(routeModule.GET);
  }

  return responseCapability(routeModule[method]);
}

function responseCapability(
  capability: RouteModule[HttpMethod],
): ResponseCapability | undefined {
  return capability?.kind === "page" ? undefined : capability;
}

function allowedCorsMethods(routeModule: RouteModule) {
  return ([
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
    "HEAD",
  ] satisfies HttpMethod[]).filter((method) => getMethodCapability(routeModule, method));
}

function isHttpMethod(method: string): method is HttpMethod {
  return (
    method === "GET" ||
    method === "POST" ||
    method === "PUT" ||
    method === "PATCH" ||
    method === "DELETE" ||
    method === "OPTIONS" ||
    method === "HEAD"
  );
}
