import { randomUUID } from "node:crypto";
import { createElement } from "react";
import {
  createMemoryCacheStore,
  createRequestHandler,
  defineMiddleware,
  defineRoutePolicy,
  page,
  response,
  security,
  type RouteProps,
} from "@demiurgejs/core";
import { createNodeRequestListener } from "@demiurgejs/core/node";
import { vercelNodeAdapter } from "@demiurgejs/core/vercel";

export type LiveListenerOptions = {
  representation: "document" | "navigation" | "control";
  sourceOrigin: string;
  sourceToken: string;
  logicalPath?: string;
};

type LiveData = {
  version: number;
  id: string;
  edition: string;
  generation: string;
  middlewareCalls: number;
};

let middlewareCalls = 0;

async function readSource(options: LiveListenerOptions): Promise<number> {
  const result = await fetch(new URL("/state", options.sourceOrigin), {
    cache: "no-store",
    redirect: "error",
    headers: { authorization: `Bearer ${options.sourceToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!result.ok) throw new Error("The live source request failed.");
  const state: unknown = await result.json();
  if (typeof state !== "object" || state === null ||
    !("version" in state) || !Number.isSafeInteger(state.version) ||
    !("fail" in state) || typeof state.fail !== "boolean" ||
    !("delayMs" in state) || typeof state.delayMs !== "number" ||
    !Number.isFinite(state.delayMs) || state.delayMs < 0 || state.delayMs > 15_000) {
    throw new Error("The live source state is invalid.");
  }
  const delayMs = state.delayMs;
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  if (state.fail) throw new Error("The live source generation failed.");
  return Number(state.version);
}

function createGeneration(options: LiveListenerOptions) {
  const generation = randomUUID();
  return createRequestHandler({
    adapter: vercelNodeAdapter,
    cacheStore: {
      namespace: { app: "private-live-isr-proof", environment: "verification", schemaVersion: 1 },
      store: createMemoryCacheStore(),
    },
    routes: {
      "./routes/@policy.ts": async () => ({
        policy: defineRoutePolicy({ access: { public: true }, document: security.static() }),
      }),
      "./routes/@middleware.ts": async () => ({
        middleware: defineMiddleware(async (_context, next) => {
          const count = ++middlewareCalls;
          const result = await next();
          result.headers.set("x-origin-middleware", String(count));
          result.headers.set("x-origin-generation", generation);
          return result;
        }),
      }),
      "./routes/public/[id].tsx": async () => ({
        GET: page<string, LiveData>({
          async data({ cache, request }) {
            const url = new URL(request.url);
            const id = url.pathname.split("/").at(-1)!;
            const edition = url.searchParams.get("edition") ?? "default";
            const load = () => cache.get({
              key: ["live-version", id, edition],
              scope: "public",
              fn: async () => ({ version: await readSource(options), id, edition, generation, middlewareCalls }),
            });
            const [first, second] = await Promise.all([load(), load()]);
            if (first !== second) throw new Error("The generation data was not deduplicated.");
            return first;
          },
          view: ({ data }: RouteProps<string, LiveData>) => createElement("main", {
            "data-version": data.version,
            "data-id": data.id,
            "data-edition": data.edition,
            "data-generation": data.generation,
            "data-middleware": data.middlewareCalls,
          }, `Version ${data.version}`),
        }),
      }),
      "./routes/private.ts": async () => ({
        GET: response(({ request }) => Response.json({
          private: request.headers.get("cookie") ?? request.headers.get("authorization") ?? "anonymous",
          generation,
        }, { headers: { "cache-control": "private, no-store", "set-cookie": "control=private; HttpOnly; Secure; SameSite=Lax" } })),
      }),
      "./routes/nonce.tsx": async () => ({
        policy: defineRoutePolicy({ document: security.strict() }),
        GET: page({ view: () => createElement("main", { "data-generation": generation }, "Nonce control") }),
      }),
    },
  });
}

export function createLiveListener(options: LiveListenerOptions) {
  if (options.logicalPath !== undefined && !/^\/public\/[a-z0-9-]+$/.test(options.logicalPath)) {
    throw new Error("The live proof logical path is invalid.");
  }
  const allowedHosts = [process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
    .filter((host): host is string => Boolean(host));
  return createNodeRequestListener({
    allowedHosts,
    async handler(incoming) {
      const url = new URL(incoming.url);
      if (!["GET", "HEAD"].includes(incoming.method)) {
        return new Response("The method is not permitted.", { status: 405, headers: { "cache-control": "no-store" } });
      }
      const control = options.representation === "control";
      const pathname = control ? url.pathname : options.logicalPath ?? url.pathname;
      const validPath = control ? ["/private", "/nonce"].includes(pathname) :
        /^\/public\/[a-z0-9-]+$/.test(pathname) &&
        (url.pathname === pathname || /^\/proof-(doc|nav)-(one|two)$/.test(url.pathname));
      if (!validPath || [...url.searchParams.keys()].some((key) => key !== "edition") ||
        url.searchParams.getAll("edition").length > 1) {
        return new Response("The request is ineligible for the live proof.", { status: 400, headers: { "cache-control": "no-store" } });
      }
      const headers = new Headers({ accept: "text/html" });
      if (options.representation === "navigation") headers.set("x-demiurge-navigation", "data");
      if (control) {
        for (const name of ["cookie", "authorization"]) {
          const value = incoming.headers.get(name);
          if (value !== null) headers.set(name, value);
        }
      }
      return createGeneration(options)(new Request(`https://generation.invalid${pathname}${url.search}`, {
        method: incoming.method,
        headers,
        signal: incoming.signal,
      }));
    },
  });
}
