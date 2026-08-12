import { Transform } from "node:stream";
import { renderToPipeableStream } from "react-dom/server";
import { renderDocumentShell } from "../document/render";
import type { LoadedRouteMatch } from "../router";
import { createPageRenderTree } from "../server/render-tree";
import {
  renderPageResponse,
  type SsrRenderOptions,
} from "../server/ssr";

const streamRootMarker = '<template data-demiurge-stream-root=""></template>';

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

  const shell = await createDocumentShell(match, options);
  const content = createPageRenderTree(match);

  return await new Promise<Response>((resolveResponse, rejectResponse) => {
    let completed = false;
    let cancelled = false;
    let responseCommitted = false;
    let stream = undefined as ReturnType<typeof renderToPipeableStream> | undefined;
    const documentStream = new Transform({
      destroy(error, callback) {
        if (!completed) {
          cancelled = true;
        }

        callback(error);
      },
      flush(callback) {
        callback(null, shell.suffix);
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
        responseCommitted = true;
        documentStream.push(shell.prefix);
        stream?.pipe(documentStream);
        resolveResponse(
          new Response(toWebReadableStream(documentStream), {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
        );
      },
    });
  });
}

function toWebReadableStream(stream: Transform) {
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

async function createDocumentShell(
  match: LoadedRouteMatch,
  options: SsrRenderOptions,
) {
  const shell = renderDocumentShell({
    body: { data: match.data, navigation: options.navigation },
    entrySrc: options.clientEntry,
    lang: options.lang,
    links: match.links,
    metadata: match.metadata,
    nonce: options.nonce,
    scripts: match.scripts,
    styles: options.styles,
    title: options.title,
  });

  if (!options.transformDocument) {
    return shell;
  }

  const transformed = await options.transformDocument(
    `${shell.prefix}${streamRootMarker}${shell.suffix}`,
  );
  const markerIndex = transformed.indexOf(streamRootMarker);

  if (
    markerIndex === -1 ||
    transformed.indexOf(streamRootMarker, markerIndex + streamRootMarker.length) !== -1
  ) {
    throw new Error(
      "Demiurge streaming document transform must preserve the root marker exactly once.",
    );
  }

  return {
    prefix: transformed.slice(0, markerIndex),
    suffix: transformed.slice(markerIndex + streamRootMarker.length),
  };
}
