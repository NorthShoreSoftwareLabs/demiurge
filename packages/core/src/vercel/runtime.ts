import { isIP } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineAdapter, type Adapter } from "../adapter";
import type { ClientBuildManifest } from "../manifest";
import {
  toWebRequest,
  UntrustedHostError,
  UnsupportedMethodError,
  validateNodeOriginPolicy,
  writeNotImplemented,
  writeWebResponse,
} from "../node/http";
import { renderNodePageResponse } from "../node/streaming";
import {
  type PageRenderer,
  type RequestCacheStoreOptions,
  type RequestHandler,
} from "../server";
import type { CacheStore } from "../data";
import type { RateLimitStore } from "../security";

export const vercelNodeAdapter = defineAdapter({
  name: "vercel-node",
  capabilities: {
    crossOriginIsolationHeaders: true,
    nonceInjection: true,
    streaming: true,
  },
});

export type VercelBuildPageOptions = {
  adapter: Adapter;
  cacheStore: RequestCacheStoreOptions;
  clientEntry: string;
  rateLimitStore: RateLimitStore;
  renderPage: PageRenderer;
  styles: string[];
};

export type VercelBuildContext = {
  page: VercelBuildPageOptions;
  root?: string;
};

export type VercelFunctionEnvironment = Record<string, string | undefined>;

export type VercelFunctionOptions = {
  allowedHosts?: readonly string[];
  createHandler: (
    context: VercelBuildContext,
  ) => RequestHandler | Promise<RequestHandler>;
  env?: VercelFunctionEnvironment;
  manifest: ClientBuildManifest;
  onError?: (error: unknown, request: IncomingMessage) => void;
};

export type VercelRequestListener = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void>;

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
  validateNodeOriginPolicy({ allowedHosts });
  const onError = options.onError ?? defaultOnError;
  const cacheStore: RequestCacheStoreOptions = {
    namespace: unavailableCacheNamespace,
    store: createUnavailableCacheStore(),
  };
  const rateLimitStore = createUnavailableRateLimitStore();
  const handler = Promise.resolve(options.createHandler({
    page: {
      adapter: vercelNodeAdapter,
      cacheStore,
      clientEntry: options.manifest.clientEntry,
      rateLimitStore,
      renderPage: renderNodePageResponse,
      styles: options.manifest.styles,
    },
  }));

  return async function handleVercelRequest(request, response) {
    const connection = createRequestAbort(request, response);

    try {
      const webRequest = toWebRequest(request, {
        allowedHosts,
        clientIp: resolveVercelClientIp(request),
        scheme: resolveVercelScheme(request),
        signal: connection.signal,
      });
      const webResponse = withDynamicCachePolicy(
        await (await handler)(webRequest),
      );

      await writeWebResponse(response, webResponse);
    } catch (error) {
      if (connection.signal.aborted) {
        return;
      }

      if (error instanceof UnsupportedMethodError) {
        writeNotImplemented(response);
        return;
      }

      if (error instanceof UntrustedHostError) {
        writeMisdirectedRequest(response);
        return;
      }

      onError(error, request);
      writeServerError(response);
    } finally {
      connection.cleanup();
    }
  };
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

function createRequestAbort(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort(new DOMException("Client disconnected.", "AbortError"));
    }
  };
  const abortPrematureResponse = () => {
    if (!response.writableFinished) {
      abort();
    }
  };

  request.once("aborted", abort);
  response.once("close", abortPrematureResponse);

  return {
    cleanup() {
      request.off("aborted", abort);
      response.off("close", abortPrematureResponse);
    },
    signal: controller.signal,
  };
}

function writeMisdirectedRequest(response: ServerResponse) {
  response.statusCode = 421;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end("Misdirected Request");
}

function writeServerError(response: ServerResponse) {
  if (response.headersSent || response.writableEnded) {
    response.destroy();
    return;
  }

  response.statusCode = 500;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end("Internal Server Error");
}

function defaultOnError(error: unknown) {
  console.error(error);
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
