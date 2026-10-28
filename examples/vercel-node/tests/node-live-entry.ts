import { randomUUID } from "node:crypto";
import { createElement } from "react";
import {
  createRequestHandler,
  defineMiddleware,
  defineRoutePolicy,
  getRequestClientAddress,
  page,
  response,
  security,
} from "@demiurgejs/core";
import type { ServerBuildPageOptions } from "@demiurgejs/core/deployment";

export function createHandler(options: ServerBuildPageOptions) {
  let backgroundRejected = false;
  try {
    createRequestHandler({ ...options, routes: {}, background: { waitUntil() {}, onError() {} } });
  } catch (error) {
    backgroundRejected = error instanceof Error && error.message.includes("backgroundLifetime");
  }
  if (!backgroundRejected) throw new Error("The provider accepted unsupported background work.");
  return createRequestHandler({
    ...options,
    routes: {
      "./routes/@policy.ts": async () => ({
        policy: defineRoutePolicy({ access: { public: true }, document: security.strict() }),
      }),
      "./routes/@middleware.ts": async () => ({
        middleware: defineMiddleware(async (_context, next) => {
          const result = await next();
          result.headers.set("x-proof-generation", randomUUID());
          result.headers.set("x-proof-runtime", process.version);
          return result;
        }),
      }),
      "./routes/index.tsx": async () => ({
        GET: page({ view: () => createElement("main", null, "Vercel production conformance") }),
      }),
      "./routes/probe/[kind].ts": async () => ({
        GET: response(({ request, url }) => {
          const kind = url.pathname.split("/").at(-1);
          if (kind === "cookies") {
            const headers = new Headers();
            headers.append("set-cookie", "proof-a=one; Path=/; Secure; HttpOnly; SameSite=Lax");
            headers.append("set-cookie", "proof-b=two; Path=/; Secure; HttpOnly; SameSite=Lax");
            return new Response("cookies", { headers });
          }
          if (kind === "request") return Response.json({ pathname: url.pathname, search: url.search, address: getRequestClientAddress(request) });
          if (kind === "private") return Response.json({ identity: request.headers.get("cookie") ?? "anonymous" });
          if (kind === "capabilities") return Response.json({ ...options.adapter.capabilities, backgroundRejected });
          if (kind === "stream") {
            const encoder = new TextEncoder();
            let timer: ReturnType<typeof setTimeout> | undefined;
            let stopped = false;
            let chunks = 0;
            return new Response(new ReadableStream<Uint8Array>({
              async start(controller) {
                const id = url.searchParams.get("id") ?? "stream";
                const record = async (event: string) => {
                  const target = new URL("/event", process.env.PROOF_EVENT_ORIGIN);
                  target.searchParams.set("id", id);
                  target.searchParams.set("event", event);
                  const result = await fetch(target, {
                    headers: { authorization: `Bearer ${process.env.PROOF_EVENT_TOKEN}`, "ngrok-skip-browser-warning": "1" },
                    redirect: "error", signal: AbortSignal.timeout(5000),
                  });
                  if (!result.ok) throw new Error("The event collector rejected a probe event.");
                  await result.body?.cancel();
                };
                await record("started");
                const stop = () => {
                  if (stopped) return;
                  stopped = true;
                  if (timer) clearTimeout(timer);
                  controller.close();
                };
                request.signal.addEventListener("abort", () => {
                  stop();
                  void record("aborted").catch(() => {});
                }, { once: true });
                const send = () => {
                  if (stopped) return;
                  controller.enqueue(encoder.encode(`${chunks++ === 0 ? "started" : "continued"}\n`));
                  if (chunks >= 8) { void record("completed").finally(stop); return; }
                  timer = setTimeout(send, 1000);
                };
                send();
              },
              cancel() { stopped = true; if (timer) clearTimeout(timer); },
            }), { headers: { "content-type": "text/plain; charset=utf-8" } });
          }
          return new Response("Unknown production probe.", { status: 404 });
        }),
      }),
    },
  });
}
