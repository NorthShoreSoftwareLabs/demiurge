import {
  createRouteManifest,
  findRouteMatch,
  isAttachedFileForRoute,
  loadPageRoute,
  type RouteManifest,
  type RouteRecord,
} from "../router";
import {
  toResponse,
  type HttpMethod,
  type HttpRouteContext,
  type ResponseCapability,
  type RouteCapability,
  type RouteImporter,
  type RouteMiddleware,
  type RouteModule,
} from "../route";
import { applyServerTimingHeader } from "../route/response";
import { renderPageResponse, type SsrOptions } from "./ssr";
import {
  applyCorsHeaders,
  createCorsPreflightResponse,
  createMemoryRateLimitStore,
  createSecurityHeaders,
  enforceCsrfProtection,
  enforceRateLimit,
  enforceRequestSecurity,
  mergeRoutePolicies,
  type RateLimitStore,
} from "../security";

export type RequestHandlerOptions = {
  rateLimitStore?: RateLimitStore;
  routes: Record<string, RouteImporter>;
  ssr?: SsrOptions;
};

type RequestRuntimeOptions = {
  rateLimitStore: RateLimitStore;
  ssr?: SsrOptions;
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

const defaultRateLimitStore = createMemoryRateLimitStore();

export function createRequestHandler(options: RequestHandlerOptions) {
  const manifest = createRouteManifest(options.routes);
  const rateLimitStore = options.rateLimitStore ?? createMemoryRateLimitStore();

  return async function handleRequest(request: Request) {
    return await handleRequestWithManifest(manifest, request, {
      rateLimitStore,
      ssr: options.ssr,
    });
  };
}

export async function handleRequestWithManifest(
  manifest: RouteManifest,
  request: Request,
  options: RequestRuntimeOptions = {
    rateLimitStore: defaultRateLimitStore,
  },
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

  const policy = await loadInheritedRoutePolicy(
    manifest,
    routeMatch.route,
    routeModule,
    capability,
  );
  const routeSecurity = policy.security;

  const csrfResponse = enforceCsrfProtection(routeSecurity?.csrf, request);

  if (csrfResponse) {
    return applyCorsHeaders(csrfResponse, getCapabilityCors(capability), request);
  }

  const rateLimitResponse = enforceRateLimit(
    routeSecurity?.rateLimit,
    request,
    options.rateLimitStore,
  );

  if (rateLimitResponse) {
    return applyCorsHeaders(
      rateLimitResponse,
      getCapabilityCors(capability),
      request,
    );
  }

  const requestSecurityResponse = enforceRequestSecurity(
    routeSecurity?.request,
    request,
    method,
  );

  if (requestSecurityResponse) {
    return applyCorsHeaders(
      requestSecurityResponse,
      getCapabilityCors(capability),
      request,
    );
  }

  if (capability.kind === "page") {
    const context = {
      path: routeMatch.path,
      pathname: url.pathname,
      request,
      search: url.searchParams,
      url,
    } satisfies HttpRouteContext;
    const middlewares = await loadInheritedRouteMiddleware(
      manifest,
      routeMatch.route,
    );
    const nonce = policy.document?.csp ? createNonce() : undefined;
    const response = await runRouteMiddleware(middlewares, context, async () => {
      const match = await loadPageRoute(manifest, url.pathname, request);

      if (match.status !== "ready") {
        throw new Error(`Unable to render page at ${url.pathname}.`);
      }

      return renderPageResponse(match.match, {
        ...options.ssr,
        nonce,
      });
    });
    const headers = createSecurityHeaders(policy.document ?? {}, { nonce });

    for (const [name, value] of headers) {
      response.headers.set(name, value);
    }

    return method === "HEAD"
      ? new Response(null, { headers: response.headers, status: response.status })
      : response;
  }

  const context = {
    path: routeMatch.path,
    pathname: url.pathname,
    request,
    search: url.searchParams,
    url,
  } satisfies HttpRouteContext;
  const middlewares = await loadInheritedRouteMiddleware(
    manifest,
    routeMatch.route,
  );
  const response = await runRouteMiddleware(middlewares, context, () =>
    toResponse(capability, context),
  );

  return finalizeRouteResponse(response, capability, request, method);
}

async function loadInheritedRoutePolicy(
  manifest: RouteManifest,
  route: RouteRecord,
  routeModule: RouteModule,
  capability: RouteCapability,
) {
  const policyModules = await Promise.all(
    manifest.policies
      .filter((policy) =>
        isAttachedFileForRoute(policy.fileSegments, route.fileSegments),
      )
      .map((policy) => policy.load()),
  );

  return mergeRoutePolicies(
    ...policyModules.map((module) => module.policy),
    routeModule.policy,
    {
      security: capability.kind === "page" ? undefined : capability.security,
    },
  );
}

async function loadInheritedRouteMiddleware(
  manifest: RouteManifest,
  route: RouteRecord,
) {
  const middlewareModules = await Promise.all(
    manifest.middlewares
      .filter((middleware) =>
        isAttachedFileForRoute(middleware.fileSegments, route.fileSegments),
      )
      .map((middleware) => middleware.load()),
  );

  return middlewareModules.flatMap((module) =>
    module.middleware ? [module.middleware] : [],
  );
}

async function runRouteMiddleware(
  middlewares: RouteMiddleware[],
  context: HttpRouteContext,
  handler: () => Promise<Response>,
) {
  let index = -1;

  async function dispatch(nextIndex: number): Promise<Response> {
    if (nextIndex <= index) {
      throw new Error("Demiurge route middleware next() called multiple times.");
    }

    index = nextIndex;

    const middleware = middlewares[nextIndex];

    if (!middleware) {
      return await handler();
    }

    return await middleware(context, () => dispatch(nextIndex + 1));
  }

  return await dispatch(0);
}

function finalizeRouteResponse(
  response: Response,
  capability: ResponseCapability,
  request: Request,
  method: HttpMethod,
) {
  const corsResponse = applyServerTimingHeader(
    applyCorsHeaders(response, capability.cors, request),
    capability.timing,
  );

  if (method === "HEAD") {
    return new Response(null, {
      headers: corsResponse.headers,
      status: corsResponse.status,
      statusText: corsResponse.statusText,
    });
  }

  return corsResponse;
}

function createNonce() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);

  return btoa(String.fromCharCode(...bytes));
}

function getCapabilityCors(capability: RouteCapability) {
  return capability.kind === "page" ? undefined : capability.cors;
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
