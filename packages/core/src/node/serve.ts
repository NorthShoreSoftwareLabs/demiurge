import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseClientManifest } from "../manifest";
import type { PageRenderer, RequestHandler } from "../server";
import {
  createNodeServer,
  type NodeGracefulShutdownOptions,
  type NodeRequestListenerOptions,
  type NodeServer,
  type NodeServerTimeouts,
} from "./index";
import type { TrustProxy } from "./http";
import { renderNodePageResponse } from "./streaming";
import type { StaticFileHandler, StaticFileHandlerOptions } from "./static";

export type NodeBuildPageOptions = {
  clientEntry: string;
  renderPage: PageRenderer;
  styles: string[];
};

export type NodeBuildContext = {
  page: NodeBuildPageOptions;
  root: string;
  waitUntil: (promise: Promise<unknown>) => void;
};

export type ServeNodeBuildEnvironment = Record<string, string | undefined>;

export type ServeNodeBuildOptions = {
  allowedHosts?: readonly string[];
  base: string | URL;
  clientDir?: string;
  createHandler: (
    context: NodeBuildContext,
  ) => RequestHandler | Promise<RequestHandler>;
  env?: ServeNodeBuildEnvironment;
  host?: string;
  name?: string;
  onError?: NodeRequestListenerOptions["onError"];
  // When set, this replaces the default listen log entirely, so `name` is
  // not used.
  onListen?: (address: { host: string; port: number; server: NodeServer }) => void;
  port?: number;
  readyPath?: string | false;
  shutdown?: NodeGracefulShutdownOptions;
  // A caller that needs a font handler or an image optimizer in front of the
  // plain file handler returns the composed handler from this factory.
  static?:
    | StaticFileHandlerOptions
    | ((context: NodeBuildContext) => StaticFileHandler | StaticFileHandlerOptions);
  timeouts?: Partial<NodeServerTimeouts>;
  trustProxy?: TrustProxy;
};

export const defaultNodeBuildClientDir = "dist/client";
export const defaultNodeBuildReadyPath = "/.well-known/ready";

/**
 * Boot a built Demiurge app as one production Node process.
 *
 * The helper reads the browser manifest, resolves the host allowlist and the
 * bind address from the environment, serves hashed assets from the client
 * build, answers the readiness path, and listens.
 */
export async function serveNodeBuild(
  options: ServeNodeBuildOptions,
): Promise<NodeServer> {
  const environment = options.env ?? process.env;
  const root = fileURLToPath(
    new URL(options.clientDir ?? defaultNodeBuildClientDir, options.base),
  );
  const manifest = parseClientManifest(
    await readFile(join(root, "demiurge-manifest.json"), "utf8"),
  );
  const host = options.host ?? environment.HOST ?? "127.0.0.1";
  const port = resolvePort(environment.PORT, options.port);
  const allowedHosts = resolveAllowedHosts(
    options.allowedHosts,
    environment.ALLOWED_HOSTS,
    host,
  );
  const name = options.name ?? "Demiurge Node server";
  const readyPath = options.readyPath === false
    ? undefined
    : options.readyPath ?? defaultNodeBuildReadyPath;

  // A caller's createHandler may call waitUntil synchronously (for example to
  // warm a cache at startup), before the server exists. Buffer those promises
  // here and flush them into the real server once it is constructed, so an
  // early call just works instead of throwing.
  const pendingWaitUntil: Promise<unknown>[] = [];
  const context: NodeBuildContext = {
    page: {
      clientEntry: manifest.clientEntry,
      renderPage: renderNodePageResponse,
      styles: manifest.styles,
    },
    root,
    waitUntil(promise) {
      pendingWaitUntil.push(promise);
    },
  };
  const handler = await options.createHandler(context);

  const server = createNodeServer({
    allowedHosts,
    handler,
    onError: options.onError,
    readyPath,
    shutdown: options.shutdown,
    static: resolveStatic(options.static, context),
    timeouts: options.timeouts,
    trustProxy: options.trustProxy,
  });

  context.waitUntil = (promise) => {
    server.waitUntil(promise);
  };
  for (const promise of pendingWaitUntil) {
    server.waitUntil(promise);
  }

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, host, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  const address = server.address();
  // Port 0 asks the operating system for a free port. Report the bound port so
  // a caller can reach the server.
  const boundPort = typeof address === "object" && address
    ? address.port
    : port;

  if (options.onListen) {
    options.onListen({ host, port: boundPort, server });
  } else {
    console.log(`${name} listening on http://${host}:${boundPort}`);
  }

  return server;
}

function resolvePort(configured: string | undefined, fallback: number | undefined) {
  const value = configured ?? String(fallback ?? 4173);
  const port = Number(value);

  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error("Demiurge Node PORT must be an integer from 0 through 65535.");
  }

  return port;
}

function resolveAllowedHosts(
  configured: readonly string[] | undefined,
  fromEnvironment: string | undefined,
  host: string,
) {
  if (configured) {
    return configured;
  }

  if (fromEnvironment) {
    return fromEnvironment
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return host === "localhost" ? [host] : [host, "localhost"];
}

function resolveStatic(
  configured: ServeNodeBuildOptions["static"],
  context: NodeBuildContext,
) {
  if (!configured) {
    return { root: context.root };
  }

  if (typeof configured !== "function") {
    return configured;
  }

  const resolved = configured(context);

  // A factory returns a StaticFileHandler or a StaticFileHandlerOptions
  // object, both synchronously. A StaticFileHandler passed directly instead
  // (the shape createNodeServer's own `static` option accepts) is an async
  // function. Calling it here as a factory always returns a Promise. That
  // catches the mistake early, with a clear message, instead of a failure
  // deep inside the static file handler.
  if (resolved instanceof Promise) {
    throw new TypeError(
      "The `static` option must be a StaticFileHandlerOptions object or a " +
        "factory `(context) => StaticFileHandler | StaticFileHandlerOptions`. " +
        "It looks like a StaticFileHandler was passed directly. Wrap it: " +
        "`static: () => yourHandler`.",
    );
  }

  return resolved;
}
