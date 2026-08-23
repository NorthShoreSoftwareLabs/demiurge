import {
  createNavigationDocument,
} from "../document";
import {
  createNavigationDataResponse,
  createRouteManifest,
  findRouteMatch,
  isNavigationDataRequest,
  isAttachedFileForRoute,
  loadPageRoute,
  MalformedPathnameError,
  markNavigationResponse,
  NAVIGATION_DATA_HEADER,
  NAVIGATION_ERROR_RESPONSE,
  NAVIGATION_NOT_FOUND_RESPONSE,
  type LoadedRouteMatch,
  type RouteManifest,
  type RouteRecord,
} from "../router";
import {
  createCache,
  createMemoryCache,
  serializeCacheNamespace,
  type CacheDuration,
  type CacheNamespace,
  type CacheStore,
} from "../data";
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
import { createProblemResponse } from "./problem";
import {
  applyCorsHeaders,
  applyFetchMetadataVary,
  createCorsPreflightResponse,
  createMemoryRateLimitStore,
  createSecurityHeaders,
  enforceCsrfProtection,
  enforceFetchMetadataPolicy,
  enforceRateLimit,
  enforceRequestSecurity,
  mergeRoutePolicies,
  type RateLimitStore,
  validateRouteModules,
} from "../security";
import type { Adapter } from "../adapter";
import {
  limitRequestBody,
  RequestBodyTooLargeError,
  requestBodyTooLargeResponse,
} from "../security/request";
import {
  createCspNonce,
  securityPolicyRequiresNonce,
} from "../security/policy";

export type RequestErrorReporter = (
  error: unknown,
  context: { pathname: string; site: FailureSite },
) => void;

export type RequestHandlerOptions = {
  adapter?: Adapter;
  cacheStore?: RequestCacheStoreOptions;
  onError?: RequestErrorReporter;
  renderPage?: PageRenderer;
  rateLimitStore?: RateLimitStore;
  routes: Record<string, RouteImporter>;
  routeModules?: Readonly<Record<string, RouteModule>>;
  ssr?: SsrOptions;
};

export type RequestCacheStoreOptions = {
  namespace: CacheNamespace;
  onBackgroundError?: (error: unknown) => void;
  refreshLeaseTtl?: CacheDuration;
  store: CacheStore;
  waitUntil?: (promise: Promise<void>) => void;
};

// Public `RequestHandlerOptions` deliberately excludes `dev` and
// `transformDocument`. The Vite plugin sets development mode when it calls
// `handleRequestWithManifest` directly. An application cannot enable this mode
// in production and expose a stack trace.
type RequestRuntimeOptions = {
  cacheStore?: RequestCacheStoreOptions;
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
  if (options.routeModules) {
    validateRouteModules(options.routeModules, { adapter: options.adapter });
  }

  const manifest = createRouteManifest(options.routes);
  const rateLimitStore = options.rateLimitStore ?? createMemoryRateLimitStore();

  if (options.cacheStore) {
    serializeCacheNamespace(options.cacheStore.namespace);
  }

  return async function handleRequest(request: Request) {
    return await handleRequestWithManifest(manifest, request, {
      cacheStore: options.cacheStore,
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
  const navigationDataRequest = isNavigationDataRequest(request);
  let routeMatch: ReturnType<typeof findRouteMatch>;

  try {
    routeMatch = findRouteMatch(manifest.routes, url.pathname);
  } catch (error) {
    if (!(error instanceof MalformedPathnameError)) {
      throw error;
    }

    const response = createProblemResponse({
      instance: `${url.pathname}${url.search}`,
      status: 400,
      title: "Bad Request",
    });
    return navigationDataRequest
      ? markNavigationResponse(response, NAVIGATION_ERROR_RESPONSE)
      : response;
  }

  if (!routeMatch) {
    try {
      const response = await renderNotFoundResponse(
        manifest,
        request,
        fallbackOptions,
      );

      return navigationDataRequest
        ? markNavigationResponse(response, NAVIGATION_NOT_FOUND_RESPONSE)
        : response;
    } catch (error) {
      fallbackOptions.onError(error, "page");

      return new Response("Not Found", {
        headers: { "content-type": "text/plain; charset=utf-8" },
        status: 404,
      });
    }
  }

  try {
    const response = await handleMatchedRoute(
      manifest,
      request,
      url,
      routeMatch,
      options,
      fallbackOptions,
    );

    if (
      navigationDataRequest &&
      !response.headers.has(NAVIGATION_DATA_HEADER)
    ) {
      return markNavigationResponse(
        response,
        response.status === 404
          ? NAVIGATION_NOT_FOUND_RESPONSE
          : NAVIGATION_ERROR_RESPONSE,
      );
    }

    return response;
  } catch (error) {
    // Anything escaping here failed before a route body ran: loading the route
    // module, resolving its capability or inherited policy, or a middleware
    // throwing. That is the one failure site with no committed response shape,
    // so it negotiates on `accept` the way an unmatched path does.
    const response = await renderFailureResponse(
      manifest,
      request,
      error,
      "middleware",
      fallbackOptions,
    );

    return navigationDataRequest
      ? markNavigationResponse(response, NAVIGATION_ERROR_RESPONSE)
      : response;
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

  // Every response for this route must declare the Fetch Metadata fields that
  // the decision read, including the responses that the route body produces.
  // Otherwise a shared cache can give one client the response of another one.
  const fetchMetadata = enforceFetchMetadataPolicy(
    routeSecurity?.fetchMetadata,
    request,
    method,
  );
  const withFetchMetadataVary = (response: Response) =>
    applyFetchMetadataVary(response, fetchMetadata.vary);

  if (fetchMetadata.response) {
    return withFetchMetadataVary(
      applyCorsHeaders(
        fetchMetadata.response,
        getCapabilityCors(capability),
        request,
      ),
    );
  }

  const csrfResponse = enforceCsrfProtection(routeSecurity?.csrf, request);

  if (csrfResponse) {
    return withFetchMetadataVary(
      applyCorsHeaders(csrfResponse, getCapabilityCors(capability), request),
    );
  }

  const rateLimitResponse = await enforceRateLimit(
    routeSecurity?.rateLimit,
    request,
    options.rateLimitStore ?? defaultRateLimitStore,
  );

  if (rateLimitResponse) {
    return withFetchMetadataVary(
      applyCorsHeaders(
        rateLimitResponse,
        getCapabilityCors(capability),
        request,
      ),
    );
  }

  const requestSecurityResponse = enforceRequestSecurity(
    routeSecurity?.request,
    request,
    method,
  );

  if (requestSecurityResponse) {
    return withFetchMetadataVary(
      applyCorsHeaders(
        requestSecurityResponse,
        getCapabilityCors(capability),
        request,
      ),
    );
  }

  request = limitRequestBody(routeSecurity?.request, request);
  const requestContext: Record<string, unknown> = {};

  if (capability.kind === "page") {
    const context = {
      path: routeMatch.path,
      pathname: url.pathname,
      request,
      context: requestContext,
      search: url.searchParams,
      url,
    } satisfies HttpRouteContext;
    const middlewares = await loadInheritedRouteMiddleware(
      manifest,
      routeMatch.route,
    );
    const nonce = securityPolicyRequiresNonce(policy.document)
      ? createCspNonce()
      : undefined;
    const cache = createRequestCache(options.cacheStore);
    let response: Response;

    try {
      response = await runRouteMiddleware(middlewares, context, async () => {
        // A page render has already committed to a document, so a failure here
        // renders the error document rather than negotiating. Returning the
        // response instead of throwing keeps the failure site distinguishable
        // from a middleware failure further out.
        try {
          const match = await loadPageRoute(
            manifest,
            url.pathname,
            request,
            undefined,
            cache,
            { requestContext },
          );

          if (match.status !== "ready") {
            return await renderNotFoundResponse(manifest, request, {
              ...fallbackOptions,
              nonce,
            });
          }

          if (isNavigationDataRequest(request)) {
            return createNavigationDataResponse(match.match.data, {
              document: createNavigationDocument({
                links: match.match.links,
                metadata: match.match.metadata,
                scripts: match.match.scripts,
                title: options.ssr?.title,
              }),
            });
          }

          if (match.match.render.mode === "streaming" && !options.renderPage) {
            throw new Error(
              "Streaming page routes require an adapter renderer. Pass renderNodePageResponse from @demiurgejs/core/node as createRequestHandler({ renderPage }).",
            );
          }

          const renderPage = options.renderPage ?? renderPageResponse;

          return await renderPage(match.match, {
            ...options.ssr,
            dev: options.dev,
            nonce,
            onStreamError: (error) => {
              options.onError?.(error, {
                pathname: url.pathname,
                site: "page",
              });
            },
            signal: request.signal,
          });
        } catch (error) {
          if (error instanceof RequestBodyTooLargeError) {
            return requestBodyTooLargeResponse();
          }

          return await renderFailureResponse(manifest, request, error, "page", {
            ...fallbackOptions,
            nonce,
          });
        }
      });
    } catch (error) {
      if (!(error instanceof RequestBodyTooLargeError)) {
        throw error;
      }

      response = requestBodyTooLargeResponse();
    }
    const headers = createSecurityHeaders(policy.document ?? {}, {
      nonce,
      request,
    });

    for (const [name, value] of headers) {
      response.headers.set(name, value);
    }

    // A CSP nonce must be unpredictable for every transmitted response. A
    // browser or shared HTTP cache replaying this document would also replay
    // its nonce, so nonce-backed documents are never reusable HTTP cache
    // representations. This intentionally overrides app-provided public cache
    // directives. Cache data or a nonce-free render artifact below this layer
    // instead.
    if (nonce) {
      response.headers.set("cache-control", "private, no-store");
    }

    withFetchMetadataVary(response);

    if (method === "HEAD") {
      await response.body?.cancel();

      return new Response(null, {
        headers: response.headers,
        status: response.status,
      });
    }

    return response;
  }

  const context = {
    path: routeMatch.path,
    pathname: url.pathname,
    request,
    context: requestContext,
    search: url.searchParams,
    url,
  } satisfies HttpRouteContext;
  const middlewares = await loadInheritedRouteMiddleware(
    manifest,
    routeMatch.route,
  );
  let response: Response;

  try {
    response = await runRouteMiddleware(middlewares, context, async () => {
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
        if (error instanceof RequestBodyTooLargeError) {
          return requestBodyTooLargeResponse();
        }

        return await renderFailureResponse(
          manifest,
          request,
          error,
          "route",
          fallbackOptions,
        );
      }
    });
  } catch (error) {
    if (!(error instanceof RequestBodyTooLargeError)) {
      throw error;
    }

    response = requestBodyTooLargeResponse();
  }

  // Finalization is part of the route failure site. Therefore, an invalid
  // `timing` or `cors` value on an API route gives a problem+json response. It
  // cannot enter the negotiated path and produce HTML.
  try {
    return withFetchMetadataVary(
      finalizeRouteResponse(response, capability, request, method),
    );
  } catch (error) {
    return withFetchMetadataVary(
      await renderFailureResponse(
        manifest,
        request,
        error,
        "route",
        fallbackOptions,
      ),
    );
  }
}

function createRequestCache(options: RequestCacheStoreOptions | undefined) {
  return options
    ? createCache(options)
    : createMemoryCache();
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

// `notFound()` without a body uses the negotiated path. Thus, an application
// cannot publish two different 404 formats. An explicit capability status or
// header still has priority.
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

// The route argument is narrower than `RouteRecord` because the route audit
// resolves the policy of a path that matches no route file.
export async function loadInheritedRoutePolicy(
  manifest: RouteManifest,
  route: Pick<RouteRecord, "fileSegments">,
  routeModule: RouteModule,
  capability: RouteCapability | undefined,
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
      security: !capability || capability.kind === "page"
        ? undefined
        : capability.security,
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

function getCapabilityCors(capability: RouteCapability) {
  return capability.kind === "page" ? undefined : capability.cors;
}

function normalizeMethod(method: string): HttpMethod | null {
  const upperMethod = method.toUpperCase();
  // TYPE-EVIDENCE: the includes check confirms the upper method is a member of the supported methods tuple. The second cast reuses that narrowing.
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
