import { Suspense, use } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  createRequestHandler,
  defineRoutePolicy,
  page,
  security,
  type RouteModule,
} from "@demiurge-js/core";
import { renderNodePageResponse } from "@demiurge-js/core/node";

function routeModule(module: RouteModule) {
  return vi.fn(async () => module);
}

function deferred<T>() {
  let reject = undefined as ((error: unknown) => void) | undefined;
  let resolve = undefined as ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });

  return {
    promise,
    reject: reject!,
    resolve: resolve!,
  };
}

function createStreamingPage(value: Promise<string>) {
  function DeferredValue() {
    return <strong>{use(value)}</strong>;
  }

  return function StreamingPage() {
    return (
      <main>
        <h1>Streaming shell</h1>
        <Suspense fallback={<p>Loading value</p>}>
          <DeferredValue />
        </Suspense>
      </main>
    );
  };
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (html: string) => boolean,
) {
  const decoder = new TextDecoder();
  let html = "";

  while (!predicate(html)) {
    const chunk = await reader.read();

    if (chunk.done) {
      break;
    }

    html += decoder.decode(chunk.value, { stream: true });
  }

  return { decoder, html };
}

async function readRemaining(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
) {
  let html = "";

  while (true) {
    const chunk = await reader.read();

    if (chunk.done) {
      return html + decoder.decode();
    }

    html += decoder.decode(chunk.value, { stream: true });
  }
}

describe("streaming page responses", () => {
  it("keeps buffered SSR behind the same Node renderer", async () => {
    const handler = createRequestHandler({
      renderPage: renderNodePageResponse,
      routes: {
        "./routes/index.tsx": routeModule({
          GET: page(() => <main>Buffered SSR</main>),
        }),
      },
    });

    const response = await handler(new Request("https://example.test/"));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("Buffered SSR");
  });

  it("fails clearly when a runtime does not provide a streaming renderer", async () => {
    const onError = vi.fn();
    const handler = createRequestHandler({
      onError,
      routes: {
        "./routes/index.tsx": routeModule({
          GET: page({
            render: { mode: "streaming" },
            view: () => <main>Streaming</main>,
          }),
        }),
      },
    });

    const response = await handler(new Request("https://example.test/"));

    expect(response.status).toBe(500);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("renderNodePageResponse"),
      }),
      { pathname: "/", site: "page" },
    );
  });

  it("flushes a nonce-backed Suspense shell before deferred content resolves", async () => {
    const value = deferred<string>();
    const handler = createRequestHandler({
      renderPage: renderNodePageResponse,
      routes: {
        "./routes/@policy.ts": routeModule({
          policy: defineRoutePolicy({ document: security.strict() }),
        }),
        "./routes/index.tsx": routeModule({
          GET: page({
            render: { mode: "streaming" },
            view: createStreamingPage(value.promise),
          }),
        }),
      },
      ssr: { clientEntry: "/assets/client.js" },
    });

    const response = await handler(new Request("https://example.test/"));
    const reader = response.body!.getReader();
    const shell = await readUntil(reader, (html) => html.includes("Loading value"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(shell.html).toContain("<!doctype html>");
    expect(shell.html).toContain("Streaming shell");
    expect(shell.html).toContain("Loading value");
    expect(shell.html).not.toContain("Deferred ready");
    expect(shell.html).not.toContain("</html>");

    value.resolve("Deferred ready");
    const html = shell.html + await readRemaining(reader, shell.decoder);
    const nonce = response.headers
      .get("content-security-policy")
      ?.match(/'nonce-([^']+)'/)?.[1];
    const scriptTags = [...html.matchAll(/<script\b([^>]*)>/g)];

    expect(html).toContain("Deferred ready");
    expect(html).toContain('id="__demiurge_data"');
    expect(html).toContain("</html>");
    expect(nonce).toBeTruthy();
    expect(scriptTags.length).toBeGreaterThanOrEqual(2);
    expect(scriptTags.every(([, attributes]) =>
      attributes.includes(`nonce="${nonce}"`)
    )).toBe(true);
  });

  it("turns a shell failure into the normal page error response", async () => {
    const error = new Error("shell failed");
    const onError = vi.fn();
    const handler = createRequestHandler({
      onError,
      renderPage: renderNodePageResponse,
      routes: {
        "./routes/index.tsx": routeModule({
          GET: page({
            render: { mode: "streaming" },
            view: () => {
              throw error;
            },
          }),
        }),
      },
    });

    const response = await handler(new Request("https://example.test/"));

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toContain("Something went wrong");
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(error, {
      pathname: "/",
      site: "page",
    });
  });

  it("reports a post-shell failure without changing the committed status", async () => {
    const value = deferred<string>();
    const error = new Error("late failure");
    const onError = vi.fn();
    const handler = createRequestHandler({
      onError,
      renderPage: renderNodePageResponse,
      routes: {
        "./routes/index.tsx": routeModule({
          GET: page({
            render: { mode: "streaming" },
            view: createStreamingPage(value.promise),
          }),
        }),
      },
    });

    const response = await handler(new Request("https://example.test/"));
    const reader = response.body!.getReader();
    const shell = await readUntil(reader, (html) => html.includes("Loading value"));

    value.reject(error);
    const html = shell.html + await readRemaining(reader, shell.decoder);

    expect(response.status).toBe(200);
    expect(html).toContain("Loading value");
    expect(html).toContain("</html>");
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(error, {
      pathname: "/",
      site: "page",
    });
  });

  it("aborts rendering quietly when the response body is cancelled", async () => {
    const value = deferred<string>();
    const onError = vi.fn();
    const handler = createRequestHandler({
      onError,
      renderPage: renderNodePageResponse,
      routes: {
        "./routes/index.tsx": routeModule({
          GET: page({
            render: { mode: "streaming" },
            view: createStreamingPage(value.promise),
          }),
        }),
      },
    });

    const response = await handler(new Request("https://example.test/"));
    const reader = response.body!.getReader();

    await readUntil(reader, (html) => html.includes("Loading value"));
    await reader.cancel("client disconnected");
    await new Promise((resolve) => setImmediate(resolve));

    expect(onError).not.toHaveBeenCalled();
  });

  it("cancels the source render for a bodiless HEAD response", async () => {
    const value = deferred<string>();
    const onError = vi.fn();
    const handler = createRequestHandler({
      onError,
      renderPage: renderNodePageResponse,
      routes: {
        "./routes/index.tsx": routeModule({
          GET: page({
            render: { mode: "streaming" },
            view: createStreamingPage(value.promise),
          }),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/", { method: "HEAD" }),
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it("stops before rendering when the request signal is already aborted", async () => {
    const controller = new AbortController();
    const error = new Error("request stopped");
    const onError = vi.fn();
    controller.abort(error);
    const handler = createRequestHandler({
      onError,
      renderPage: renderNodePageResponse,
      routes: {
        "./routes/index.tsx": routeModule({
          GET: page({
            render: { mode: "streaming" },
            view: () => <main>Never rendered</main>,
          }),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/", { signal: controller.signal }),
    );

    expect(response.status).toBe(500);
    expect(onError).toHaveBeenCalledWith(error, {
      pathname: "/",
      site: "page",
    });
  });

  it("aborts an active render when the request signal fires", async () => {
    const value = deferred<string>();
    const controller = new AbortController();
    const onError = vi.fn();
    const handler = createRequestHandler({
      onError,
      renderPage: renderNodePageResponse,
      routes: {
        "./routes/index.tsx": routeModule({
          GET: page({
            render: { mode: "streaming" },
            view: createStreamingPage(value.promise),
          }),
        }),
      },
    });
    const response = await handler(
      new Request("https://example.test/", { signal: controller.signal }),
    );
    const reader = response.body!.getReader();

    await readUntil(reader, (html) => html.includes("Loading value"));
    controller.abort(new Error("request stopped"));
    await reader.read().catch(() => ({ done: true as const, value: undefined }));
    await new Promise((resolve) => setImmediate(resolve));

    expect(onError).not.toHaveBeenCalled();
  });

  it.each([
    ["remove", () => "<html></html>"],
    [
      "duplicate",
      (html: string) =>
        `${html}<template data-demiurge-stream-root=""></template>`,
    ],
  ])("fails when a document transform %ss the stream marker", async (_name, transform) => {
    const onError = vi.fn();
    const handler = createRequestHandler({
      onError,
      renderPage: (match, options) =>
        renderNodePageResponse(match, {
          ...options,
          transformDocument: transform,
        }),
      routes: {
        "./routes/index.tsx": routeModule({
          GET: page({
            render: { mode: "streaming" },
            view: () => <main>Streaming</main>,
          }),
        }),
      },
    });

    const response = await handler(new Request("https://example.test/"));

    expect(response.status).toBe(500);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("preserve the root marker"),
      }),
      { pathname: "/", site: "page" },
    );
  });
});
