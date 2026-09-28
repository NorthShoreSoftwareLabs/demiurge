import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestHandler } from "../server";
import {
  type HttpScheme,
  toWebRequest,
  UntrustedHostError,
  UnsupportedMethodError,
  validateNodeOriginPolicy,
  writeNotImplemented,
  writeWebResponse,
} from "./http";

export type ManagedNodeRequestMetadata = {
  clientIp?: string;
  scheme?: HttpScheme;
};

export type ManagedNodeRequestListenerOptions = {
  allowedHosts: readonly string[];
  handler: RequestHandler | Promise<RequestHandler>;
  onError?: (error: unknown, request: IncomingMessage) => void;
  requestMetadata?: (request: IncomingMessage) => ManagedNodeRequestMetadata;
  transformResponse?: (response: Response) => Response | Promise<Response>;
};

export type ManagedNodeRequestListener = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void>;

export function createManagedNodeRequestListener(
  options: ManagedNodeRequestListenerOptions,
): ManagedNodeRequestListener {
  validateNodeOriginPolicy({ allowedHosts: options.allowedHosts });
  const handler = Promise.resolve(options.handler);
  const onError = options.onError ?? defaultOnError;

  return async function handleManagedNodeRequest(request, response) {
    const connection = createRequestAbort(request, response);

    try {
      const metadata = options.requestMetadata?.(request) ?? {};
      const webRequest = toWebRequest(request, {
        allowedHosts: options.allowedHosts,
        clientIp: metadata.clientIp,
        scheme: metadata.scheme,
        signal: connection.signal,
      });
      const webResponse = await (await handler)(webRequest);
      const output = options.transformResponse
        ? await options.transformResponse(webResponse)
        : webResponse;

      await writeWebResponse(response, output);
    } catch (error) {
      if (connection.signal.aborted) return;

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
    if (!response.writableFinished) abort();
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
