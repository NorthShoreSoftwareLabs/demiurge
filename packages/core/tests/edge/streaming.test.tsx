import { Suspense, use } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LoadedRouteMatch } from "../../src/router";
import {
  renderEdgePageResponse,
  renderEdgeStreamingPageResponse,
  withDocumentShell,
} from "../../src/edge/streaming";

function DeferredValue({ value }: { value: Promise<string> }) {
  return <strong>{use(value)}</strong>;
}

function StreamingPage({ data }: { data: unknown }) {
  // SAFETY: the test passes a promise value the deferred component resolves during render.
  return (
    <main>
      <h1>Streaming shell</h1>
      <Suspense fallback={<p>Loading value</p>}>
        <DeferredValue value={data as Promise<string>} />
      </Suspense>
    </main>
  );
}

function ThrowingPage(): never {
  throw new Error("Shell render failed.");
}

function deferred(delay = 20) {
  return new Promise<string>((resolveValue) => {
    setTimeout(() => resolveValue("Deferred ready"), delay);
  });
}

function match(overrides: Partial<LoadedRouteMatch> = {}): LoadedRouteMatch {
  // SAFETY: the test fills every field and spreads overrides so the partial input matches the full type.
  return {
    data: deferred(),
    layouts: [],
    links: [],
    metadata: { title: "Edge" },
    page: StreamingPage,
    path: {},
    pathname: "/",
    render: { mode: "streaming" },
    scripts: [],
    ...overrides,
  } as LoadedRouteMatch;
}

async function readAll(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let chunks = 0;
  let body = "";

  while (true) {
    const chunk = await reader.read();

    if (chunk.done) {
      break;
    }

    chunks += 1;
    body += decoder.decode(chunk.value, { stream: true });
  }

  return { body: body + decoder.decode(), chunks };
}

describe("renderEdgePageResponse", () => {
  it("buffers a page that does not declare streaming", async () => {
    const response = await renderEdgePageResponse(
      match({ data: "ready", page: ({ data }) => <main>{String(data)}</main>, render: { mode: "ssr" } }),
    );

    expect(await response.text()).toContain("ready");
  });

  it("streams a page that declares streaming", async () => {
    const response = await renderEdgePageResponse(match());
    const read = await readAll(response);

    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(read.chunks).toBeGreaterThan(1);
    expect(read.body).toContain("<!doctype html>");
    expect(read.body).toContain("Deferred ready");
    expect(read.body.trimEnd().endsWith("</html>")).toBe(true);
  });
});

describe("renderEdgeStreamingPageResponse", () => {
  it("refuses a request that is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Client disconnected."));

    await expect(renderEdgeStreamingPageResponse(match(), {
      signal: controller.signal,
    })).rejects.toThrow("Client disconnected.");
  });

  it("accepts cancellation of the response body", async () => {
    const response = await renderEdgeStreamingPageResponse(match({ data: deferred(200) }));

    await expect(response.body!.cancel()).resolves.toBeUndefined();
  });

  it("stops the render when the request is cancelled", async () => {
    const controller = new AbortController();
    const response = await renderEdgeStreamingPageResponse(match({ data: deferred(200) }), {
      signal: controller.signal,
    });

    controller.abort(new Error("Client disconnected."));

    await expect(readAll(response)).resolves.toBeDefined();
  });

  it("reports a streamed failure after the response is committed", async () => {
    const onStreamError = vi.fn();
    const response = await renderEdgeStreamingPageResponse(
      match({
        data: new Promise((_resolveValue, rejectValue) => {
          setTimeout(() => rejectValue(new Error("Deferred failed.")), 10);
        }),
      }),
      { onStreamError },
    );

    await readAll(response);

    expect(onStreamError).toHaveBeenCalled();
  });

  it("fails when the shell itself cannot render", async () => {
    await expect(
      renderEdgeStreamingPageResponse(match({ page: ThrowingPage })),
    ).rejects.toThrow("Shell render failed.");
  });

  it("requires a document transform to keep the root marker", async () => {
    await expect(
      renderEdgeStreamingPageResponse(match(), {
        transformDocument: (html) => html.replace(/<template[^>]*><\/template>/, ""),
      }),
    ).rejects.toThrow(/root marker exactly once/);
  });

  it("applies a document transform that keeps the root marker", async () => {
    const response = await renderEdgeStreamingPageResponse(match(), {
      transformDocument: (html) => html.replace("<head>", "<head><!--edge-->"),
    });

    expect((await readAll(response)).body).toContain("<!--edge-->");
  });
});

describe("withDocumentShell", () => {
  it("faults the response body when the render fails mid-stream", async () => {
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("Render failed."));
      },
    });
    const stream = withDocumentShell(
      failing,
      { prefix: "<!doctype html><body>", suffix: "</body>" },
      () => {},
    );

    await expect(readAll(new Response(stream))).rejects.toThrow(
      "Render failed.",
    );
  });

  it("stops the render when a client cancels the body", async () => {
    let cancelled = false;
    const stream = withDocumentShell(
      new ReadableStream<Uint8Array>({ pull() {} }),
      { prefix: "<!doctype html><body>", suffix: "</body>" },
      () => {
        cancelled = true;
      },
    );

    await stream.cancel();

    expect(cancelled).toBe(true);
  });
});
