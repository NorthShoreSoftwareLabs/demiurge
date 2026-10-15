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
import type { ServerBuildPageOptions } from "@demiurgejs/core/vercel";

let version = 1;
let middlewareCalls = 0;
let reads = 0;
let fail = false;
const namespace = { app: "private-isr-proof", environment: "local", schemaVersion: 1 };
const sharedStore = createMemoryCacheStore();

type Data = { version: number; id: string; reads: number; input: string; edition: string };

export function updateSource(nextVersion: number, shouldFail = false) {
  version = nextVersion;
  fail = shouldFail;
}

export function counters() {
  return { middlewareCalls, reads };
}

const routes = {
  "./routes/@policy.ts": async () => ({
    policy: defineRoutePolicy({ access: { public: true }, document: security.static() }),
  }),
  "./routes/@middleware.ts": async () => ({
    middleware: defineMiddleware(async (_context, next) => {
      middlewareCalls++;
      const result = await next();
      result.headers.set("x-origin-middleware", String(middlewareCalls));
      return result;
    }),
  }),
  "./routes/public/[id].tsx": async () => ({
    GET: page<string, Data>({
      async data({ cache, request }) {
        const id = new URL(request.url).pathname.split("/").at(-1)!;
        const edition = new URL(request.url).searchParams.get("edition") ?? "default";
        const load = () => cache.get({
          key: ["version", id, edition],
          scope: "public",
          fn: () => {
            reads++;
            if (fail) throw new Error("The investigation source failed.");
            return { version, id, edition, reads, input: request.headers.get("x-private-input") ?? "public" };
          },
        });
        const [first, second] = await Promise.all([load(), load()]);
        if (first !== second) throw new Error("Generation data was not deduplicated.");
        return first;
      },
      view: ({ data }: RouteProps<string, Data>) => createElement("main", {
        "data-version": data.version,
        "data-id": data.id,
        "data-input": data.input,
        "data-edition": data.edition,
      }, `Version ${data.version}`),
    }),
  }),
  "./routes/private.ts": async () => ({
    GET: response(({ request }) => Response.json({
      private: request.headers.get("cookie") ?? request.headers.get("authorization") ?? "anonymous",
    }, { headers: { "cache-control": "private, no-store", "set-cookie": "control=private; HttpOnly" } })),
  }),
  "./routes/nonce.tsx": async () => ({
    policy: defineRoutePolicy({ document: security.strict() }),
    GET: page({ view: () => createElement("main", undefined, "Nonce control") }),
  }),
};

export function createHandler(options: ServerBuildPageOptions) {
  return createRequestHandler({
    ...options,
    cacheStore: { namespace, store: sharedStore },
    routes,
    ssr: { clientEntry: options.clientEntry, styles: options.styles },
  });
}

export function createGenerationHandler(options: ServerBuildPageOptions) {
  return createRequestHandler({
    ...options,
    cacheStore: { namespace, store: createMemoryCacheStore() },
    routes,
    ssr: { clientEntry: options.clientEntry, styles: options.styles },
  });
}

export function createCandidateHandler(options: ServerBuildPageOptions, navigation: boolean) {
  return async (incoming: Request) => {
    const url = new URL(incoming.url);
    const marker = incoming.headers.get("x-demiurge-navigation");
    if (!/^\/public\/[a-z0-9-]+$/.test(url.pathname) ||
      !["GET", "HEAD"].includes(incoming.method) ||
      incoming.headers.has("cookie") || incoming.headers.has("authorization") ||
      [...url.searchParams.keys()].some((key) => key !== "edition") ||
      url.searchParams.getAll("edition").length > 1 ||
      (marker !== null && marker !== "data")) {
      return new Response("The request is ineligible for the local cache candidate.", { status: 400 });
    }
    const handler = createGenerationHandler(options);
    return handler(new Request(`https://generation.invalid${url.pathname}${url.search}`, {
      headers: navigation ? { "x-demiurge-navigation": "data" } : { accept: "text/html" },
      method: incoming.method,
    }));
  };
}
