import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { defineAdapter } from "../adapter";
import type { RequestHandler } from "../server";
import {
  UntrustedHostError,
  UnsupportedMethodError,
  toWebRequest,
  validateNodeOriginPolicy,
  writeNotImplemented,
  writeWebResponse,
} from "./http";
import { createStaticFileHandler } from "./static";
import type { StaticFileHandler, StaticFileHandlerOptions } from "./static";

export {
  UntrustedHostError,
  UnsupportedMethodError,
  toHeaders,
  toWebRequest,
  validateNodeOriginPolicy,
  writeWebResponse,
} from "./http";
export { createStaticFileHandler } from "./static";
export {
  renderNodePageResponse,
  renderStreamingPageResponse,
} from "./streaming";
export type {
  HttpScheme,
  NodeOriginPolicy,
  ToWebRequestOptions,
  TrustProxy,
} from "./http";
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

export type NodeRequestListenerOptions = import("./http").NodeOriginPolicy & {
  handler: RequestHandler;
  onError?: (error: unknown, request: IncomingMessage) => void;
  static?: StaticFileHandler | StaticFileHandlerOptions;
};

export type NodeServerTimeouts = {
  headersTimeout: number;
  keepAliveTimeout: number;
  requestTimeout: number;
};

export type NodeShutdownSignal = "SIGINT" | "SIGTERM";
export type NodeServerState = "draining" | "ready" | "stopped";

export type NodeGracefulShutdownOptions = {
  gracePeriod?: number;
  onStateChange?: (state: NodeServerState) => void;
  signals?: readonly NodeShutdownSignal[];
};

export type NodeServerOptions = NodeRequestListenerOptions & {
  shutdown?: NodeGracefulShutdownOptions;
  timeouts?: Partial<NodeServerTimeouts>;
};

export type NodeServer = Server & {
  isReady: () => boolean;
  shutdown: () => Promise<void>;
};

export const defaultNodeServerTimeouts = {
  headersTimeout: 66_000,
  keepAliveTimeout: 65_000,
  requestTimeout: 300_000,
} as const satisfies NodeServerTimeouts;

const defaultShutdownGracePeriod = 30_000;

export function createNodeRequestListener(
  options: NodeRequestListenerOptions,
): NodeRequestListener {
  validateNodeOriginPolicy(options);
  const serveStaticFile = toStaticFileHandler(options.static);
  const onError = options.onError ?? defaultOnError;

  return function handleNodeRequest(request, response) {
    const connection = createRequestAbort(request, response);

    void respond(request, response, connection.signal)
      .catch((error: unknown) => {
        if (connection.signal.aborted) {
          return;
        }

        onError(error, request);
        writeServerError(response);
      })
      .finally(connection.cleanup);
  };

  async function respond(
    request: IncomingMessage,
    response: ServerResponse,
    signal: AbortSignal,
  ) {
    let webRequest: Request;

    try {
      webRequest = toWebRequest(request, {
        allowedHosts: options.allowedHosts,
        signal,
        trustProxy: options.trustProxy,
      });
    } catch (error) {
      if (error instanceof UnsupportedMethodError) {
        writeNotImplemented(response);
        return;
      }

      if (error instanceof UntrustedHostError) {
        writeMisdirectedRequest(response);
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
    if (!response.writableFinished) {
      abort();
    }
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

export function createNodeServer(
  options: NodeServerOptions,
): NodeServer {
  const timeouts = normalizeNodeServerTimeouts(options.timeouts);
  const server = createServer(createNodeRequestListener(options)) as NodeServer;
  server.keepAliveTimeout = timeouts.keepAliveTimeout;
  server.headersTimeout = timeouts.headersTimeout;
  server.requestTimeout = timeouts.requestTimeout;

  return attachNodeServerLifecycle(server, options.shutdown);
}

function normalizeNodeServerTimeouts(
  configured: Partial<NodeServerTimeouts> | undefined,
) {
  const timeouts = {
    ...defaultNodeServerTimeouts,
    ...configured,
  } satisfies NodeServerTimeouts;

  for (const [name, value] of Object.entries(timeouts)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(
        `Demiurge Node ${name} must be a positive integer in milliseconds.`,
      );
    }
  }

  if (timeouts.headersTimeout <= timeouts.keepAliveTimeout) {
    throw new Error(
      "Demiurge Node headersTimeout must be greater than keepAliveTimeout.",
    );
  }

  return timeouts;
}

function attachNodeServerLifecycle(
  server: NodeServer,
  options: NodeGracefulShutdownOptions | undefined,
) {
  const gracePeriod = options?.gracePeriod ?? defaultShutdownGracePeriod;

  if (!Number.isSafeInteger(gracePeriod) || gracePeriod < 0) {
    throw new Error(
      "Demiurge Node shutdown gracePeriod must be a non-negative integer in milliseconds.",
    );
  }

  let draining = false;
  let shutdownPromise: Promise<void> | undefined;
  const signalHandlers = new Map<NodeShutdownSignal, () => void>();
  const activeResponses = new Map<Socket, number>();

  server.on("connection", (socket) => {
    activeResponses.set(socket, 0);
    socket.once("close", () => activeResponses.delete(socket));
  });
  server.on("request", (_request, response) => {
    const socket = response.socket;

    if (!socket) {
      return;
    }

    activeResponses.set(socket, (activeResponses.get(socket) ?? 0) + 1);
    let settled = false;
    const settle = () => {
      if (settled) {
        return;
      }

      settled = true;
      const remaining = Math.max(0, (activeResponses.get(socket) ?? 1) - 1);
      activeResponses.set(socket, remaining);

      if (draining && remaining === 0) {
        socket.destroy();
      }
    };
    response.once("finish", settle);
    response.once("close", settle);
  });

  server.isReady = () => server.listening && !draining;
  server.shutdown = () => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    draining = true;
    options?.onStateChange?.("draining");
    shutdownPromise = new Promise<void>((resolveShutdown, rejectShutdown) => {
      const forceTimer = setTimeout(() => {
        server.closeAllConnections();
      }, gracePeriod);

      server.close((error) => {
        clearTimeout(forceTimer);
        removeSignalHandlers();
        options?.onStateChange?.("stopped");

        if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
          rejectShutdown(error);
          return;
        }

        resolveShutdown();
      });
      server.closeIdleConnections();
      closeTrackedIdleConnections();
      // A response can finish in the same turn shutdown begins and transition
      // from active to idle just after the first sweep.
      setImmediate(() => {
        server.closeIdleConnections();
        closeTrackedIdleConnections();
      });
    });

    return shutdownPromise;
  };

  server.on("listening", () => options?.onStateChange?.("ready"));

  for (const signal of new Set(options?.signals ?? [])) {
    const handler = () => {
      void server.shutdown().catch(defaultOnError);
    };
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }

  server.once("close", removeSignalHandlers);

  return server;

  function removeSignalHandlers() {
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler);
    }

    signalHandlers.clear();
  }

  function closeTrackedIdleConnections() {
    for (const [socket, count] of activeResponses) {
      if (count === 0) {
        socket.destroy();
      }
    }
  }
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
