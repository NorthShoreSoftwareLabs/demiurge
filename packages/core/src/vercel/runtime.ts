import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";
import { defineAdapter } from "../adapter";
import type { ClientBuildManifest } from "../manifest";
import { createManagedNodeRequestListener } from "../node/managed";
import { renderNodePageResponse } from "../node/streaming";
import type { RequestCacheStoreOptions } from "../server";
import type { CacheStore } from "../data";
import type { RateLimitStore } from "../security";
import type {
  ServerBuildPageOptions,
  ServerBuildRuntime,
} from "../deployment/server-runtime";

export const vercelNodeAdapter = defineAdapter({
  name: "vercel-node",
  capabilities: {
    crossOriginIsolationHeaders: true,
    nonceInjection: true,
    streaming: true,
  },
});

export type VercelBuildPageOptions = ServerBuildPageOptions;

export type VercelFunctionEnvironment = Record<string, string | undefined>;

export type VercelFunctionOptions = {
  allowedHosts?: readonly string[];
  cacheStore: RequestCacheStoreOptions | "unavailable";
  createHandler: ServerBuildRuntime["createHandler"];
  env?: VercelFunctionEnvironment;
  manifest: ClientBuildManifest;
  onError?: (error: unknown, request: IncomingMessage) => void;
  rateLimitStore: RateLimitStore | "unavailable";
};

export type VercelRequestListener = ReturnType<
  typeof createManagedNodeRequestListener
>;

const unavailableCacheNamespace = {
  app: "demiurge-vercel",
  environment: "unavailable",
  schemaVersion: 1,
} as const;

export function createVercelFunction(
  options: VercelFunctionOptions,
): VercelRequestListener {
  const environment = options.env ?? process.env;
  const allowedHosts = resolveAllowedHosts(options.allowedHosts, environment);
  const cacheStore = resolveCacheStore(options.cacheStore);
  const rateLimitStore = resolveRateLimitStore(options.rateLimitStore);
  const handler = options.createHandler({
    adapter: vercelNodeAdapter,
    cacheStore,
    clientEntry: options.manifest.clientEntry,
    rateLimitStore,
    renderPage: renderNodePageResponse,
    styles: options.manifest.styles,
  });

  return createManagedNodeRequestListener({
    allowedHosts,
    handler,
    onError: options.onError,
    requestMetadata(request) {
      return {
        clientIp: resolveVercelClientIp(request),
        scheme: resolveVercelScheme(request),
      };
    },
    transformResponse: withDynamicCachePolicy,
  });
}

function resolveCacheStore(
  option: RequestCacheStoreOptions | "unavailable",
): RequestCacheStoreOptions {
  return option === "unavailable"
    ? {
        namespace: unavailableCacheNamespace,
        store: createUnavailableCacheStore(),
      }
    : option;
}

function resolveRateLimitStore(
  option: RateLimitStore | "unavailable",
): RateLimitStore {
  return option === "unavailable"
    ? createUnavailableRateLimitStore()
    : option;
}

function resolveAllowedHosts(
  configured: readonly string[] | undefined,
  environment: VercelFunctionEnvironment,
) {
  const declared = environment.ALLOWED_HOSTS?.split(",") ?? [];
  const hosts = [
    ...(configured ?? []),
    ...declared,
    environment.VERCEL_URL,
    environment.VERCEL_PROJECT_PRODUCTION_URL,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  return [...new Set(hosts)];
}

function resolveVercelScheme(request: IncomingMessage) {
  const value = singleHeader(request.headers["x-forwarded-proto"]);

  if (value === "http" || value === "https") {
    return value;
  }

  if (value === undefined) return "http";

  throw new Error(`Vercel sent an unsupported request protocol "${value}".`);
}

function resolveVercelClientIp(request: IncomingMessage) {
  const value = singleHeader(request.headers["x-vercel-forwarded-for"]);

  if (value === undefined) {
    return undefined;
  }

  if (isIP(value) === 0) {
    throw new Error(`Vercel sent an invalid client address "${value}".`);
  }

  return value;
}

function singleHeader(value: string | string[] | undefined) {
  if (typeof value === "string") return value.trim();
  if (value === undefined) return undefined;
  throw new Error("Vercel sent a repeated request header.");
}

function withDynamicCachePolicy(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  headers.set("vercel-cdn-cache-control", "no-store");

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

class VercelSharedStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VercelSharedStoreError";
  }
}

function createUnavailableCacheStore(): CacheStore {
  const refuse = (): never => {
    throw new VercelSharedStoreError(
      'Demiurge Vercel has no shared cache store. Pass a shared CacheStore, or keep the cache scope at "request".',
    );
  };

  return {
    capabilities: { atomicity: "best-effort" },
    acquireRefreshLease: refuse,
    delete: refuse,
    get: refuse,
    invalidateTags: refuse,
    publishRefresh: refuse,
    releaseRefreshLease: refuse,
    set: refuse,
  };
}

function createUnavailableRateLimitStore(): RateLimitStore {
  return {
    increment() {
      throw new VercelSharedStoreError(
        "Demiurge Vercel has no shared rate limit store. Pass a shared RateLimitStore, or remove the rate limit policy.",
      );
    },
  };
}
