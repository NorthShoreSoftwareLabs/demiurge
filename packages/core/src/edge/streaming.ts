import { renderToReadableStream } from "react-dom/server";
import type { LoadedRouteMatch } from "../router";
import {
  createDocumentShell,
  type DocumentShell,
} from "../server/document-shell";
import {
  createPageRenderTree,
  createPageScriptContext,
} from "../server/render-tree";
import { renderPageResponse, type SsrRenderOptions } from "../server/ssr";

export function renderEdgePageResponse(
  match: LoadedRouteMatch,
  options: SsrRenderOptions = {},
) {
  return match.render.mode === "streaming"
    ? renderEdgeStreamingPageResponse(match, options)
    : renderPageResponse(match, options);
}

// An edge runtime has no Node stream. React renders into a Web
// ReadableStream, and the document shell is added around it with a second
// Web stream. Nothing in this path touches a Node built-in.
export async function renderEdgeStreamingPageResponse(
  match: LoadedRouteMatch,
  options: SsrRenderOptions = {},
): Promise<Response> {
  if (options.signal?.aborted) {
    throw options.signal.reason;
  }

  const scripts = createPageScriptContext(match, options);
  const content = createPageRenderTree(match, scripts);
  const renderAbort = new AbortController();
  let committed = false;
  const abortRender = () => {
    renderAbort.abort(
      options.signal?.reason ??
        new Error("Demiurge streaming response was cancelled."),
    );
  };

  options.signal?.addEventListener("abort", abortRender, { once: true });

  let stream: Awaited<ReturnType<typeof renderToReadableStream>>;

  try {
    stream = await renderToReadableStream(content, {
      nonce: options.nonce,
      onError(error) {
        if (committed && !renderAbort.signal.aborted) {
          options.onStreamError?.(error);
        }
      },
      signal: renderAbort.signal,
    });
  } catch (error) {
    options.signal?.removeEventListener("abort", abortRender);
    throw error;
  }

  // A cancelled render rejects this promise, and nothing else awaits it. An
  // unhandled rejection would fault the isolate instead of the response.
  stream.allReady.catch(ignoreRejection);

  let shell: DocumentShell;

  try {
    shell = await createDocumentShell(match, {
      ...options,
      scripts: scripts.scripts(),
    });
  } catch (error) {
    options.signal?.removeEventListener("abort", abortRender);
    abortRender();
    await stream.cancel().catch(ignoreRejection);
    throw error;
  }

  scripts.flushHead();
  committed = true;

  return new Response(withDocumentShell(stream, shell, abortRender), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export function withDocumentShell(
  body: ReadableStream<Uint8Array>,
  shell: DocumentShell,
  onCancel: () => void,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const reader = body.getReader();

  return new ReadableStream<Uint8Array>({
    async cancel(reason) {
      onCancel();
      await reader.cancel(reason).catch(ignoreRejection);
    },
    async pull(controller) {
      let chunk: ReadableStreamReadResult<Uint8Array>;

      try {
        chunk = await reader.read();
      } catch (error) {
        controller.error(error);
        return;
      }

      if (chunk.done) {
        controller.enqueue(encoder.encode(shell.suffix));
        controller.close();
        return;
      }

      controller.enqueue(chunk.value);
    },
    start(controller) {
      controller.enqueue(encoder.encode(shell.prefix));
    },
  });
}

// A cancelled render rejects more than one promise, and none of them is a
// request failure. The rejection is absorbed rather than logged.
function ignoreRejection() {}
