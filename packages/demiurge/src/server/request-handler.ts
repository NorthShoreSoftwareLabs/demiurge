import {
  createRouteManifest,
  findRouteMatch,
  isAttachedFileForRoute,
  loadPageRoute,
  type LoadedRouteMatch,
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
import {
  renderPageResponse,
  type SsrOptions,
  type SsrRenderOptions,
} from "./ssr";
import { renderFailureResponse } from "./errors";
import type { FailureSite } from "./failure-site";
import { renderNotFoundResponse } from "./not-found";
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

export type RequestErrorReporter = (
  error: unknown,
  context: { pathname: string; site: FailureSite },
) => void;

export type RequestHandlerOptions = {
  onError?: RequestErrorReporter;
  renderPage?: PageRenderer;
  rateLimitStore?: RateLimitStore;
  routes: Record<string, RouteImporter>;
  ssr?: SsrOptions;
};

// `dev` and `transformDocument` are deliberately absent from the public
// `RequestHandlerOptions`. Dev is a build mode the Vite plugin sets when it
// calls `handleRequestWithManifest` directly, not something an app can switch
// on in production and leak a stack trace with.
type RequestRuntimeOptions = {
  dev?: boolean;
  onError?: RequestErrorReporter;
  renderPage?: PageRenderer;
  rateLimitStore?: RateLimitStore;
  ssr?: SsrOptions;
  transformDocument?: (html: string) => string | Promise<string>;
};

export type RequestHandler = (request: Request) => Promise<Response>;

export type PageRenderer = (
  match: LoadedRouteMatch,
  options: SsrRenderOptions,
) => Response | Promise<Response>;

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
      onError: options.onError,
      rateLimitStore,
      renderPage: options.renderPage,
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
  const fallbackOptions = createFallbackOptions(url, options);
  const routeMatch = findRouteMatch(manifest.routes, url.pathname);

  if (!routeMatch) {
    try {
      return await renderNotFoundResponse(manifest, request, fallbackOptions);
    } catch (error) {
      fallbackOptions.onError(error, "page");

      return new Response("Not Found", {
        headers: { "content-type": "text/plain; charset=utf-8" },
        status: 404,
      });
    }
  }

  try {
    return await handleMatchedRoute(
      manifest,
      request,
      url,
      routeMatch,
      options,
      fallbackOptions,
    );
  } catch (error) {
    // Anything escaping here failed before a route body ran: loading the route
    // module, resolving its capability or inherited policy, or a middleware
    // throwing. That is the one failure site with no committed response shape,
    // so it negotiates on `accept` the way an unmatched path does.
    return await renderFailureResponse(
      manifest,
      request,
      error,
      "middleware",
      fallbackOptions,
    );
  }
}

async function handleMatchedRoute(
  manifest: RouteManifest,
  request: Request,
  url: URL,
  routeMatch: NonNullable<ReturnType<typeof findRouteMatch>>,
  options: RequestRuntimeOptions,
  fallbackOptions: ReturnType<typeof createFallbackOptions>,
) {
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
    options.rateLimitStore ?? defaultRateLimitStore,
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
      // A page render has already committed to a document, so a failure here
      // renders the error document rather than negotiating. Returning the
      // response instead of throwing keeps the failure site distinguishable
      // from a middleware failure further out.
      try {
        const match = await loadPageRoute(manifest, url.pathname, request);

        if (match.status !== "ready") {
          return await renderNotFoundResponse(manifest, request, {
            ...fallbackOptions,
            nonce,
          });
        }

        const renderPage = options.renderPage ?? renderPageResponse;

        return await renderPage(match.match, {
          ...options.ssr,
          nonce,
        });
      } catch (error) {
        return await renderFailureResponse(manifest, request, error, "page", {
          ...fallbackOptions,
          nonce,
        });
      }
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
  const response = await runRouteMiddleware(middlewares, context, async () => {
    // An API route never gets HTML, whatever the caller asked for.
    try {
      if (capability.kind === "not-found" && capability.body === undefined) {
        return applyCapabilityInit(
          await renderNotFoundResponse(manifest, request, fallbackOptions),
          capability.init,
        );
      }

      return await toResponse(capability, context);
    } catch (error) {
      return await renderFailureResponse(
        manifest,
        request,
        error,
        "route",
        fallbackOptions,
      );
    }
  });

  // Finalization is still the route's own failure site, so a bad `timing` or
  // `cors` value on an API route yields problem+json rather than falling out
  // to the negotiated path and risking HTML.
  try {
    return finalizeRouteResponse(response, capability, request, method);
  } catch (error) {
    return await renderFailureResponse(
      manifest,
      request,
      error,
      "route",
      fallbackOptions,
    );
  }
}

function createFallbackOptions(url: URL, options: RequestRuntimeOptions) {
  return {
    ...options.ssr,
    dev: options.dev,
    onError: (error: unknown, site: FailureSite) => {
      options.onError?.(error, { pathname: url.pathname, site });
    },
    transformDocument: options.transformDocument,
  };
}

// `notFound()` without a body routes through the negotiated path so an app
// cannot end up shipping two different 404 shapes, while an explicit status or
// header on the capability still wins.
function applyCapabilityInit(response: Response, init: ResponseInit | undefined) {
  if (!init) {
    return response;
  }

  const headers = new Headers(response.headers);
  const capabilityHeaders = new Headers(init.headers);

  for (const [name, value] of capabilityHeaders) {
    if (name === "set-cookie") {
      continue;
    }

    headers.set(name, value);
  }

  // `set-cookie` is the one header that legitimately repeats, and iterating a
  // `Headers` collapses it into a single comma-joined value. Appending each
  // cookie back is the same guarantee `writeWebResponse` already makes.
  for (const cookie of capabilityHeaders.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }

  return new Response(response.body, {
    headers,
    status: init.status ?? response.status,
    statusText: init.statusText ?? response.statusText,
  });
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
