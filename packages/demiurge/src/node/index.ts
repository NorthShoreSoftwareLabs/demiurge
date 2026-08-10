import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { defineAdapter } from "../adapter";
import type { RequestHandler } from "../server";
import {
  UnsupportedMethodError,
  toWebRequest,
  writeNotImplemented,
  writeWebResponse,
} from "./http";
import { createStaticFileHandler } from "./static";
import type { StaticFileHandler, StaticFileHandlerOptions } from "./static";

export {
  UnsupportedMethodError,
  toHeaders,
  toWebRequest,
  writeWebResponse,
} from "./http";
export { createStaticFileHandler } from "./static";
export {
  renderNodePageResponse,
  renderStreamingPageResponse,
} from "./streaming";
export type { ToWebRequestOptions } from "./http";
export type { StaticFileHandler, StaticFileHandlerOptions } from "./static";

export const nodeAdapter = defineAdapter({
  name: "node",
  capabilities: {
    crossOriginIsolationHeaders: true,
    nonceInjection: true,
    streaming: true,
  },
});

export type NodeRequestListener = (
  request: IncomingMessage,
  response: ServerResponse,
) => void;

export type NodeRequestListenerOptions = {
  handler: RequestHandler;
  onError?: (error: unknown, request: IncomingMessage) => void;
  protocol?: "http" | "https";
  static?: StaticFileHandler | StaticFileHandlerOptions;
};

export function createNodeRequestListener(
  options: NodeRequestListenerOptions,
): NodeRequestListener {
  const serveStaticFile = toStaticFileHandler(options.static);
  const onError = options.onError ?? defaultOnError;

  return function handleNodeRequest(request, response) {
    void respond(request, response).catch((error: unknown) => {
      onError(error, request);
      writeServerError(response);
    });
  };

  async function respond(
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    let webRequest: Request;

    try {
      webRequest = toWebRequest(request, { protocol: options.protocol });
    } catch (error) {
      if (error instanceof UnsupportedMethodError) {
        writeNotImplemented(response);
        return;
      }

      throw error;
    }

    const staticResponse = await serveStaticFile?.(webRequest);

    await writeWebResponse(
      response,
      staticResponse ?? (await options.handler(webRequest)),
    );
  }
}

export function createNodeServer(
  options: NodeRequestListenerOptions,
): Server {
  return createServer(createNodeRequestListener(options));
}

function toStaticFileHandler(
  value: StaticFileHandler | StaticFileHandlerOptions | undefined,
) {
  if (!value) {
    return undefined;
  }

  return typeof value === "function" ? value : createStaticFileHandler(value);
}

function defaultOnError(error: unknown) {
  console.error(error);
}

// The body stays generic on purpose. A stack trace here would hand an attacker
// file paths and framework internals for free.
function writeServerError(response: ServerResponse) {
  if (response.headersSent) {
    response.destroy();
    return;
  }

  response.statusCode = 500;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end("Internal Server Error");
}
