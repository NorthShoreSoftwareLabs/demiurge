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

  // The cache store and the route pipeline hand background work to the server
  // that does not exist yet. The closure reads it after listen, so the later
  // binding is always set.
  const context: NodeBuildContext = {
    page: {
      clientEntry: manifest.clientEntry,
      renderPage: renderNodePageResponse,
      styles: manifest.styles,
    },
    root,
    waitUntil(promise) {
      server.waitUntil(promise);
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

  return typeof configured === "function" ? configured(context) : configured;
}
