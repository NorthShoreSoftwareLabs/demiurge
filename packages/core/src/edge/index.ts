import { defineAdapter } from "../adapter";
import type { HttpMethod, RouteModule } from "../route";
import { setRequestConnectionMetadata } from "../server/request-metadata";
import {
  createRequestHandler,
  type RequestCacheStoreOptions,
  type RequestHandler,
  type RequestHandlerOptions,
} from "../server";
import type { RateLimitStore } from "../security";
import { createEdgeAssetHandler } from "./assets";
import type { EdgeAssetHandler, EdgeAssetHandlerOptions } from "./assets";
import { renderEdgePageResponse } from "./streaming";
import {
  createUnavailableCacheStore,
  createUnavailableRateLimitStore,
} from "./stores";

export { createEdgeAssetHandler } from "./assets";
export {
  renderEdgePageResponse,
  renderEdgeStreamingPageResponse,
} from "./streaming";
export {
  createUnavailableCacheStore,
  createUnavailableRateLimitStore,
  EdgeSharedStoreError,
} from "./stores";
export type {
  EdgeAsset,
  EdgeAssetHandler,
  EdgeAssetHandlerOptions,
  EdgeAssetMap,
} from "./assets";

// The edge adapter declares only what a Web-platform runtime proves through
// the shared adapter contract. Streaming uses a Web ReadableStream, and the
// two header capabilities travel on the Response the handler returns.
// Background lifetime stays false because an isolate has no shutdown to wait
// on, and a host waitUntil call is best effort. Shared cache stays false
// because no shared store backend ships yet. Static output belongs to the
// static adapter.
export const edgeAdapter = defineAdapter({
  name: "edge",
  capabilities: {
    crossOriginIsolationHeaders: true,
    nonceInjection: true,
    streaming: true,
  },
});

export const EDGE_SHARED_STORE_UNAVAILABLE = "unavailable";

export type EdgeCacheStoreOption =
  | RequestCacheStoreOptions
  | typeof EDGE_SHARED_STORE_UNAVAILABLE;

export type EdgeRateLimitStoreOption =
  | RateLimitStore
  | typeof EDGE_SHARED_STORE_UNAVAILABLE;

export type EdgeRequestHandlerOptions =
  & Omit<RequestHandlerOptions, "adapter" | "cacheStore" | "rateLimitStore">
  & {
    assets?: EdgeAssetHandler | EdgeAssetHandlerOptions;
    // Both store options are required. An omitted store is the silent
    // per-isolate default this adapter exists to prevent, so construction
    // refuses it and names the option to set.
    cacheStore: EdgeCacheStoreOption;
    // An edge host reports the client address in a header it owns, and the
    // framework does not guess which one. A rate limit keyed on "ip" needs
    // this function to read that header.
    clientIp?: (request: Request) => string | undefined | null;
    rateLimitStore: EdgeRateLimitStoreOption;
  };

const unavailableCacheNamespace = {
  app: "demiurge-edge",
  environment: "unavailable",
  schemaVersion: 1,
} as const;

const httpMethods = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
] as const satisfies readonly HttpMethod[];

export function createEdgeRequestHandler(
  options: EdgeRequestHandlerOptions,
): RequestHandler {
  const cacheStore = resolveCacheStore(options.cacheStore);
  const rateLimitStore = resolveRateLimitStore(options.rateLimitStore);

  if (
    options.rateLimitStore === EDGE_SHARED_STORE_UNAVAILABLE &&
    options.routeModules
  ) {
    assertNoRateLimitPolicies(options.routeModules);
  }

  const serveAsset = toEdgeAssetHandler(options.assets);
  const handleRequest = createRequestHandler({
    adapter: edgeAdapter,
    cacheStore,
    onError: options.onError,
    rateLimitStore,
    renderPage: options.renderPage ?? renderEdgePageResponse,
    routeModules: options.routeModules,
    routes: options.routes,
    ssr: options.ssr,
  });

  return async function handleEdgeRequest(request) {
    const clientIp = options.clientIp?.(request);

    if (clientIp) {
      setRequestConnectionMetadata(request, { clientIp });
    }

    const asset = await serveAsset?.(request);

    return asset ?? await handleRequest(request);
  };
}

function resolveCacheStore(
  option: EdgeCacheStoreOption | undefined,
): RequestCacheStoreOptions {
  if (option === EDGE_SHARED_STORE_UNAVAILABLE) {
    return {
      namespace: unavailableCacheNamespace,
      store: createUnavailableCacheStore(),
    };
  }

  if (!option || typeof option.store !== "object") {
    throw new Error(
      'Demiurge edge cacheStore is required. Pass a shared cache store, or pass "unavailable" to make a shared cache scope fail instead of caching per isolate.',
    );
  }

  return option;
}

function resolveRateLimitStore(
  option: EdgeRateLimitStoreOption | undefined,
): RateLimitStore {
  if (option === EDGE_SHARED_STORE_UNAVAILABLE) {
    return createUnavailableRateLimitStore();
  }

  if (!option || typeof option.increment !== "function") {
    throw new Error(
      'Demiurge edge rateLimitStore is required. Pass a shared rate limit store, or pass "unavailable" to make a rate limit policy fail instead of counting per isolate.',
    );
  }

  return option;
}

// A rate limit policy is visible before the first request when the caller
// hands over the route modules. Reporting it at construction beats a 500 on
// the request the policy was meant to protect.
function assertNoRateLimitPolicies(
  modules: Readonly<Record<string, RouteModule>>,
) {
  for (const [file, routeModule] of Object.entries(modules)) {
    const declared = routeModule.policy?.security?.rateLimit ??
      httpMethods
        .map((method) => routeModule[method])
        .find((capability) =>
          capability && capability.kind !== "page" && capability.security?.rateLimit
        );

    if (declared) {
      throw new Error(
        `Demiurge edge route ${JSON.stringify(file)} declares a rate limit policy, and this handler declares rateLimitStore "unavailable". Pass a shared rate limit store, or remove the policy.`,
      );
    }
  }
}

function toEdgeAssetHandler(
  value: EdgeAssetHandler | EdgeAssetHandlerOptions | undefined,
) {
  if (!value) {
    return undefined;
  }

  return typeof value === "function" ? value : createEdgeAssetHandler(value);
}
