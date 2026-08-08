import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { Readable } from "node:stream";
import { resolve, relative, sep } from "node:path";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import type { OutputBundle, OutputChunk } from "rollup";
import type { Plugin, UserConfig, ViteDevServer } from "vite";
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
import {
  applyCorsHeaders,
  createCorsPreflightResponse,
  createMemoryRateLimitStore,
  enforceCsrfProtection,
  enforceRateLimit,
  enforceRequestSecurity,
} from "../security";

export type DemiurgeVitePluginOptions = {
  document?: {
    lang?: string;
    title?: string;
  };
  routesDir?: string;
  styles?: false | string;
  typedRoutes?: boolean | {
    outputFile?: string;
  };
};

const CLIENT_ENTRY_ID = "virtual:demiurge/client-entry";
const RESOLVED_CLIENT_ENTRY_ID = `\0${CLIENT_ENTRY_ID}`;
const DEFAULT_TYPED_ROUTES_OUTPUT = ".demiurge/route-manifest.d.ts";
const devRateLimitStore = createMemoryRateLimitStore();

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
    config(config) {
      return createViteConfig(config);
    },
    configResolved(config) {
      root = config.root;
    },
    resolveId(id) {
      if (id === CLIENT_ENTRY_ID) {
        return RESOLVED_CLIENT_ENTRY_ID;
      }

      return null;
    },
    load(id) {
      if (id === RESOLVED_CLIENT_ENTRY_ID) {
        return createClientEntrySource(root, options);
      }

      return null;
    },
    generateBundle(_outputOptions, bundle) {
      const entry = findClientEntryChunk(bundle);

      if (!entry) {
        return;
      }

      this.emitFile({
        fileName: "index.html",
        source: createDocumentHtml({
          entrySrc: `/${entry.fileName}`,
          lang: options.document?.lang,
          title: options.document?.title,
        }),
        type: "asset",
      });
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
            if (shouldServeDocument(webRequest)) {
              await writeHtmlResponse(response, await createDevDocument(server, options));
              return;
            }

            next();
            return;
          }

          if (result === "document") {
            await writeHtmlResponse(response, await createDevDocument(server, options));
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

function createViteConfig(config: UserConfig): UserConfig {
  return {
    appType: "custom",
    build: {
      rollupOptions: {
        input: config.build?.rollupOptions?.input ?? CLIENT_ENTRY_ID,
      },
    },
  };
}

export function createClientEntrySource(
  root: string,
  options: DemiurgeVitePluginOptions = {},
) {
  const routesDir = options.routesDir ?? "src/routes";
  const routesGlob = toRootAbsoluteGlob(routesDir);
  const routesPrefix = toRootAbsolutePrefix(routesDir);
  const stylesImport = createStylesImport(root, options);

  return `import { StrictMode, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createFileRouter } from "demiurge";
${stylesImport}

const routeModules = import.meta.glob(${JSON.stringify(routesGlob)});
const routePrefix = ${JSON.stringify(routesPrefix)};
const routes = Object.fromEntries(
  Object.entries(routeModules).map(([file, load]) => [
    \`./routes/\${file.slice(routePrefix.length)}\`,
    load,
  ]),
);
const Router = createFileRouter({ routes });
const root = document.getElementById("root");

if (!root) {
  throw new Error("Demiurge expected a #root element in the framework document.");
}

createRoot(root).render(
  createElement(StrictMode, null, createElement(Router)),
);
`;
}

function toRootAbsoluteGlob(routesDir: string) {
  return `/${routesDir.replace(/^\/|\/$/g, "")}/**/*.tsx`;
}

function toRootAbsolutePrefix(routesDir: string) {
  return `/${routesDir.replace(/^\/|\/$/g, "")}/`;
}

function createStylesImport(
  root: string,
  options: DemiurgeVitePluginOptions,
) {
  if (options.styles === false) {
    return "";
  }

  const stylesFile = options.styles ?? "src/styles.css";
  const resolvedStylesFile = resolve(root, stylesFile);

  return existsSync(resolvedStylesFile)
    ? `import ${JSON.stringify(`/${stylesFile.replace(/^\/+/, "")}`)};`
    : "";
}

async function createDevDocument(
  server: ViteDevServer,
  options: DemiurgeVitePluginOptions,
) {
  const html = createDocumentHtml({
    entrySrc: `/${CLIENT_ENTRY_ID}`,
    lang: options.document?.lang,
    title: options.document?.title,
  });

  return await server.transformIndexHtml("/", html);
}

export function createDocumentHtml({
  entrySrc,
  lang = "en",
  title = "Demiurge App",
}: {
  entrySrc: string;
  lang?: string;
  title?: string;
}) {
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${escapeHtml(entrySrc)}"></script>
  </body>
</html>
`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function findClientEntryChunk(bundle: OutputBundle) {
  return Object.values(bundle).find(
    (item): item is OutputChunk =>
      item.type === "chunk" &&
      item.isEntry &&
      item.facadeModuleId === RESOLVED_CLIENT_ENTRY_ID,
  );
}

async function generateTypedRoutes(
  root: string,
  options: DemiurgeVitePluginOptions,
) {
  const routesDir = resolve(root, options.routesDir ?? "src/routes");
  const outputFile = resolve(
    root,
    typeof options.typedRoutes === "object"
      ? options.typedRoutes.outputFile ?? DEFAULT_TYPED_ROUTES_OUTPUT
      : DEFAULT_TYPED_ROUTES_OUTPUT,
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

  if (request.method.toUpperCase() === "OPTIONS") {
    const preflightResponse = createCorsPreflightResponse(routeModule, request);

    if (preflightResponse) {
      return preflightResponse;
    }
  }

  const method = normalizeMethod(request.method);

  if (!method) {
    return methodNotAllowed(routeModule);
  }

  const capability = getMethodCapability(routeModule, method);

  if (!capability) {
    return methodNotAllowed(routeModule);
  }

  if (capability.kind === "page") {
    return "document" as const;
  }

  const csrfResponse = enforceCsrfProtection(capability.security?.csrf, request);

  if (csrfResponse) {
    return applyCorsHeaders(csrfResponse, capability.cors, request);
  }

  const rateLimitResponse = enforceRateLimit(
    capability.security?.rateLimit,
    request,
    devRateLimitStore,
  );

  if (rateLimitResponse) {
    return applyCorsHeaders(rateLimitResponse, capability.cors, request);
  }

  const requestSecurityResponse = enforceRequestSecurity(
    capability.security?.request,
    request,
    method,
  );

  if (requestSecurityResponse) {
    return applyCorsHeaders(requestSecurityResponse, capability.cors, request);
  }

  const response = await toResponse(capability, {
    path: routeMatch.path,
    pathname: url.pathname,
    request,
    search: url.searchParams,
    url,
  } satisfies HttpRouteContext);
  const corsResponse = applyCorsHeaders(response, capability.cors, request);

  if (method === "HEAD") {
    return new Response(null, {
      headers: corsResponse.headers,
      status: corsResponse.status,
      statusText: corsResponse.statusText,
    });
  }

  return corsResponse;
}

function shouldServeDocument(request: Request) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }

  const accept = request.headers.get("accept");

  return !accept || accept.includes("text/html");
}

function writeHtmlResponse(
  serverResponse: ServerResponse,
  html: string,
) {
  serverResponse.statusCode = 200;
  serverResponse.setHeader("content-type", "text/html; charset=utf-8");
  serverResponse.end(html);
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
