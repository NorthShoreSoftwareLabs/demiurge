import { readdir } from "node:fs/promises";
import { Readable } from "node:stream";
import { resolve, relative, sep } from "node:path";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";
import { generateRoutes } from "../routing/generate";
import {
  createRouteManifest,
  findRouteMatch,
  type RouteManifest,
} from "../router";
import {
  toResponse,
  type HttpMethod,
  type HttpRouteContext,
  type ResponseCapability,
  type RouteCapability,
  type RouteImporter,
  type RouteModule,
} from "../route";

export type DemiurgeVitePluginOptions = {
  routesDir?: string;
  typedRoutes?: boolean | {
    outputFile?: string;
  };
};

const supportedMethods = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
] satisfies HttpMethod[];

export function demiurge(options: DemiurgeVitePluginOptions = {}): Plugin {
  let root = process.cwd();

  return {
    name: "demiurge",
    configResolved(config) {
      root = config.root;
    },
    async buildStart() {
      if (!options.typedRoutes) {
        return;
      }

      await generateTypedRoutes(root, options);
    },
    configureServer(server) {
      if (options.typedRoutes) {
        const routesDir = resolve(
          server.config.root,
          options.routesDir ?? "src/routes",
        );

        void generateTypedRoutes(server.config.root, options);
        server.watcher.add(routesDir);
        server.watcher.on("add", (file) => {
          if (isRouteFile(routesDir, file)) {
            void generateTypedRoutes(server.config.root, options);
          }
        });
        server.watcher.on("change", (file) => {
          if (isRouteFile(routesDir, file)) {
            void generateTypedRoutes(server.config.root, options);
          }
        });
        server.watcher.on("unlink", (file) => {
          if (isRouteFile(routesDir, file)) {
            void generateTypedRoutes(server.config.root, options);
          }
        });
      }

      server.middlewares.use(async (request, response, next) => {
        try {
          const routesDir = resolve(
            server.config.root,
            options.routesDir ?? "src/routes",
          );
          const routes = await createDevRouteImporters(server, routesDir);
          const manifest = createRouteManifest(routes);
          const webRequest = toWebRequest(request);
          const result = await handleDevRequest(manifest, webRequest);

          if (result === "next") {
            next();
            return;
          }

          await writeWebResponse(response, result);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

async function generateTypedRoutes(
  root: string,
  options: DemiurgeVitePluginOptions,
) {
  const routesDir = resolve(root, options.routesDir ?? "src/routes");
  const outputFile = resolve(
    root,
    typeof options.typedRoutes === "object"
      ? options.typedRoutes.outputFile ?? "src/route-manifest.d.ts"
      : "src/route-manifest.d.ts",
  );

  await generateRoutes({ outputFile, routesDir });
}

function isRouteFile(routesDir: string, file: string) {
  return (
    file.startsWith(routesDir) &&
    /\.tsx?$/.test(file)
  );
}

export async function createDevRouteImporters(
  server: ViteDevServer,
  routesDir: string,
) {
  const files = await findRouteFiles(routesDir);
  const routes: Record<string, RouteImporter> = {};

  for (const file of files) {
    const routeKey = toRouteKey(routesDir, file);
    routes[routeKey] = async () =>
      (await server.ssrLoadModule(file)) as RouteModule;
  }

  return routes;
}

export async function handleDevRequest(
  manifest: RouteManifest,
  request: Request,
) {
  const url = new URL(request.url);
  const routeMatch = findRouteMatch(manifest.routes, url.pathname);

  if (!routeMatch) {
    return "next" as const;
  }

  const routeModule = await routeMatch.route.load();
  const method = normalizeMethod(request.method);

  if (!method) {
    return methodNotAllowed(routeModule);
  }

  const capability = getMethodCapability(routeModule, method);

  if (!capability) {
    return methodNotAllowed(routeModule);
  }

  if (capability.kind === "page") {
    return "next" as const;
  }

  const response = await toResponse(capability, {
    path: routeMatch.path,
    pathname: url.pathname,
    request,
    search: url.searchParams,
    url,
  } satisfies HttpRouteContext);

  if (method === "HEAD") {
    return new Response(null, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  return response;
}

async function findRouteFiles(directory: string) {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });

  return entries
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => resolve(entry.parentPath, entry.name));
}

function toRouteKey(routesDir: string, file: string) {
  const relativePath = relative(routesDir, file).split(sep).join("/");
  return `./routes/${relativePath}`;
}

function toWebRequest(request: IncomingMessage) {
  const origin = `http://${request.headers.host ?? "localhost"}`;
  const url = new URL(request.url ?? "/", origin);
  const init: RequestInit & { duplex?: "half" } = {
    headers: toHeaders(request.headers),
    method: request.method,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = Readable.toWeb(request) as ReadableStream;
    init.duplex = "half";
  }

  return new Request(url, init);
}

async function writeWebResponse(
  serverResponse: ServerResponse,
  webResponse: Response,
) {
  serverResponse.statusCode = webResponse.status;
  serverResponse.statusMessage = webResponse.statusText;
  webResponse.headers.forEach((value, name) => {
    serverResponse.setHeader(name, value);
  });

  if (!webResponse.body) {
    serverResponse.end();
    return;
  }

  await new Promise<void>((resolveWrite, rejectWrite) => {
    Readable.fromWeb(webResponse.body as unknown as import("node:stream/web").ReadableStream)
      .on("error", rejectWrite)
      .on("end", resolveWrite)
      .pipe(serverResponse);
  });
}

function toHeaders(headers: IncomingHttpHeaders) {
  const nextHeaders = new Headers();

  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        nextHeaders.append(name, item);
      }
      continue;
    }

    if (value) {
      nextHeaders.set(name, value);
    }
  }

  return nextHeaders;
}

function normalizeMethod(method: string): HttpMethod | null {
  const upperMethod = method.toUpperCase();
  return supportedMethods.includes(upperMethod as HttpMethod)
    ? (upperMethod as HttpMethod)
    : null;
}

function getMethodCapability(
  routeModule: RouteModule,
  method: HttpMethod,
): RouteCapability | ResponseCapability | undefined {
  if (method === "HEAD") {
    return routeModule.HEAD ?? routeModule.GET;
  }

  return routeModule[method];
}

function methodNotAllowed(routeModule: RouteModule) {
  return new Response(null, {
    headers: {
      allow: allowedMethods(routeModule).join(", "),
    },
    status: 405,
  });
}

function allowedMethods(routeModule: RouteModule) {
  const methods = supportedMethods.filter((method) => routeModule[method]);

  if (routeModule.GET && !methods.includes("HEAD")) {
    methods.push("HEAD");
  }

  return methods;
}
