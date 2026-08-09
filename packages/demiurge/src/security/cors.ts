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

  if (!origin) {
    return headers;
  }

  const allowedOrigin = resolveAllowedOrigin(policy, origin);

  if (!allowedOrigin) {
    return headers;
  }

  headers.set("access-control-allow-origin", allowedOrigin);

  if (allowedOrigin !== "*") {
    headers.append("vary", "Origin");
  }

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
      target.set("vary", `${target.get("vary")}, ${value}`);
      return;
    }

    target.set(name, value);
  });
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
