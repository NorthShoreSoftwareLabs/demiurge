import {
  createRouteManifest,
  findRouteMatch,
  type RouteManifest,
} from "../router";
import {
  toResponse,
  type HttpMethod,
  type HttpRouteContext,
  type ResponseCapability,
  type RouteCapability,
  type RouteImporter,
  type RouteModule,
} from "../route";
import {
  applyCorsHeaders,
  createCorsPreflightResponse,
  enforceCsrfProtection,
  enforceRequestSecurity,
} from "../security";

export type RequestHandlerOptions = {
  routes: Record<string, RouteImporter>;
};

export type RequestHandler = (request: Request) => Promise<Response>;

const supportedMethods = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
] satisfies HttpMethod[];

export function createRequestHandler(options: RequestHandlerOptions) {
  const manifest = createRouteManifest(options.routes);

  return async function handleRequest(request: Request) {
    return await handleRequestWithManifest(manifest, request);
  };
}

export async function handleRequestWithManifest(
  manifest: RouteManifest,
  request: Request,
) {
  const url = new URL(request.url);
  const routeMatch = findRouteMatch(manifest.routes, url.pathname);

  if (!routeMatch) {
    return new Response(null, { status: 404 });
  }

  const routeModule = await routeMatch.route.load();

  if (request.method.toUpperCase() === "OPTIONS") {
    const preflightResponse = createCorsPreflightResponse(routeModule, request);

    if (preflightResponse) {
      return preflightResponse;
    }
  }

  const method = normalizeMethod(request.method);

  if (!method) {
    return methodNotAllowed(routeModule);
  }

  const capability = getMethodCapability(routeModule, method);

  if (!capability) {
    return methodNotAllowed(routeModule);
  }

  if (capability.kind === "page") {
    return new Response("Page responses need an SSR or RSC renderer.", {
      status: 501,
    });
  }

  const csrfResponse = enforceCsrfProtection(capability.security?.csrf, request);

  if (csrfResponse) {
    return applyCorsHeaders(csrfResponse, capability.cors, request);
  }

  const requestSecurityResponse = enforceRequestSecurity(
    capability.security?.request,
    request,
  );

  if (requestSecurityResponse) {
    return applyCorsHeaders(requestSecurityResponse, capability.cors, request);
  }

  const response = await toResponse(capability, {
    path: routeMatch.path,
    pathname: url.pathname,
    request,
    search: url.searchParams,
    url,
  } satisfies HttpRouteContext);
  const corsResponse = applyCorsHeaders(response, capability.cors, request);

  if (method === "HEAD") {
    return new Response(null, {
      headers: corsResponse.headers,
      status: corsResponse.status,
      statusText: corsResponse.statusText,
    });
  }

  return corsResponse;
}

function normalizeMethod(method: string): HttpMethod | null {
  const upperMethod = method.toUpperCase();
  return supportedMethods.includes(upperMethod as HttpMethod)
    ? (upperMethod as HttpMethod)
    : null;
}

function getMethodCapability(
  routeModule: RouteModule,
  method: HttpMethod,
): RouteCapability | ResponseCapability | undefined {
  if (method === "HEAD") {
    return routeModule.HEAD ?? routeModule.GET;
  }

  return routeModule[method];
}

function methodNotAllowed(routeModule: RouteModule) {
  return new Response(null, {
    headers: {
      allow: allowedMethods(routeModule).join(", "),
    },
    status: 405,
  });
}

function allowedMethods(routeModule: RouteModule) {
  const methods = supportedMethods.filter((method) => routeModule[method]);

  if (routeModule.GET && !methods.includes("HEAD")) {
    methods.push("HEAD");
  }

  return methods;
}
