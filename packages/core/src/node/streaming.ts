import { Transform } from "node:stream";
import { renderToPipeableStream } from "react-dom/server";
import type { LoadedRouteMatch } from "../router";
import { createDocumentShell } from "../server/document-shell";
import { createPageRenderTree } from "../server/render-tree";
import { createPageScriptContext } from "../server/render-tree";
import {
  renderPageResponse,
  type SsrRenderOptions,
} from "../server/ssr";

export function renderNodePageResponse(
  match: LoadedRouteMatch,
  options: SsrRenderOptions = {},
) {
  return match.render.mode === "streaming"
    ? renderStreamingPageResponse(match, options)
    : renderPageResponse(match, options);
}

export async function renderStreamingPageResponse(
  match: LoadedRouteMatch,
  options: SsrRenderOptions = {},
) {
  if (options.signal?.aborted) {
    throw options.signal.reason;
  }

  const scripts = createPageScriptContext(match, options);
  const content = createPageRenderTree(match, scripts);

  return await new Promise<Response>((resolveResponse, rejectResponse) => {
    let completed = false;
    let cancelled = false;
    let responseCommitted = false;
    let documentSuffix = "";
    // TYPE-EVIDENCE: undefined is a member of the declared union type. The cast only makes the variable type explicit.
    let stream = undefined as ReturnType<typeof renderToPipeableStream> | undefined;
    const documentStream = new Transform({
      destroy(error, callback) {
        if (!completed) {
          cancelled = true;
        }

        callback(error);
      },
      flush(callback) {
        callback(null, documentSuffix);
      },
      transform(chunk, _encoding, callback) {
        callback(null, chunk);
      },
    });
    const abort = () => {
      cancelled = true;
      stream?.abort(options.signal?.reason);
      documentStream.destroy();
    };
    const cleanup = () => options.signal?.removeEventListener("abort", abort);

    documentStream.once("finish", () => {
      completed = true;
    });
    documentStream.once("close", () => {
      cleanup();

      if (!completed) {
        cancelled = true;
        stream?.abort(new Error("Demiurge streaming response was cancelled."));
      }
    });
    options.signal?.addEventListener("abort", abort, { once: true });

    stream = renderToPipeableStream(content, {
      nonce: options.nonce,
      onError(error) {
        if (responseCommitted && !cancelled) {
          options.onStreamError?.(error);
        }
      },
      onShellError(error) {
        cleanup();
        rejectResponse(error);
      },
      onShellReady() {
        void (async () => {
          try {
            const shell = await createDocumentShell(match, {
              ...options,
              scripts: scripts.scripts(),
            });
            documentSuffix = shell.suffix;
            scripts.flushHead();
            documentStream.push(shell.prefix);
            responseCommitted = true;
            stream?.pipe(documentStream);
            resolveResponse(
              new Response(toWebReadableStream(documentStream), {
                headers: { "content-type": "text/html; charset=utf-8" },
              }),
            );
          } catch (error) {
            cleanup();
            stream?.abort(error);
            documentStream.destroy();
            rejectResponse(error);
          }
        })();
      },
    });
  });
}

export function toWebReadableStream(stream: Transform) {
  let closed = false;
  let removeListeners = () => {};

  return new ReadableStream<Uint8Array>({
    cancel() {
      closed = true;
      removeListeners();
      stream.pause();
      stream.destroy();
    },
    pull() {
      stream.resume();
    },
    start(controller) {
      stream.on("data", onData);
      stream.once("end", onEnd);
      stream.once("error", onError);
      stream.once("close", onClose);

      function onData(chunk: Buffer) {
        if (closed) {
          return;
        }

        controller.enqueue(Uint8Array.from(chunk));

        if ((controller.desiredSize ?? 1) <= 0) {
          stream.pause();
        }
      }

      function onEnd() {
        if (!closed) {
          closed = true;
          cleanup();
          controller.close();
        }
      }

      function onError(error: Error) {
        if (!closed) {
          closed = true;
          cleanup();
          controller.error(error);
        }
      }

      function onClose() {
        if (!closed) {
          closed = true;
          cleanup();
          controller.close();
        }
      }

      function cleanup() {
        stream.off("data", onData);
        stream.off("end", onEnd);
        stream.off("error", onError);
        stream.off("close", onClose);
      }

      removeListeners = cleanup;
    },
  });
}
