import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import type { ServerResponse } from "node:http";
import type { OutputBundle, OutputChunk } from "rollup";
import type { Plugin, UserConfig, ViteDevServer } from "vite";
import { renderDocument } from "../document";
import type {
  LinkTag,
  ResolvedMetadata,
  ScriptTag,
} from "../document";
import { generateRoutes } from "../routing/generate";
import {
  createRouteManifest,
  findRouteMatch,
  loadPageRoute,
  type RouteManifest,
} from "../router";
import {
  handleRequestWithManifest,
  renderPageDocument,
} from "../server";
import {
  type RouteImporter,
  type RouteModule,
} from "../route";
import { toWebRequest, writeWebResponse } from "../node/http";

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
const SERVER_ENTRY_ID = "virtual:demiurge/server-entry";
const RESOLVED_SERVER_ENTRY_ID = `\0${SERVER_ENTRY_ID}`;
const DEFAULT_TYPED_ROUTES_OUTPUT = ".demiurge/route-manifest.d.ts";
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

      if (id === SERVER_ENTRY_ID) {
        return RESOLVED_SERVER_ENTRY_ID;
      }

      return null;
    },
    load(id) {
      if (id === RESOLVED_CLIENT_ENTRY_ID) {
        return createClientEntrySource(root, options);
      }

      if (id === RESOLVED_SERVER_ENTRY_ID) {
        return createServerEntrySource(root, options);
      }

      return null;
    },
    generateBundle(_outputOptions, bundle) {
      const entry = findClientEntryChunk(bundle);

      if (!entry) {
        return;
      }

      const styles = Object.values(bundle)
        .filter(
          (asset): asset is Extract<(typeof bundle)[string], { type: "asset" }> =>
            asset.type === "asset" && asset.fileName.endsWith(".css"),
        )
        .map((asset) => `/${asset.fileName}`);
      const clientEntry = `/${entry.fileName}`;

      this.emitFile({
        fileName: "index.html",
        source: createDocumentHtml({
          entrySrc: clientEntry,
          lang: options.document?.lang,
          styles,
          title: options.document?.title,
        }),
        type: "asset",
      });
      this.emitFile({
        fileName: "demiurge-manifest.json",
        source: JSON.stringify({ clientEntry, styles }, null, 2),
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
          const result = await handleDevRequest(manifest, webRequest, {
            renderPage: async (match, renderOptions) => {
              const html = await server.transformIndexHtml(
                "/",
                renderPageDocument(match, {
                  ...renderOptions,
                  clientEntry: `/${CLIENT_ENTRY_ID}`,
                }),
              );

              return new Response(html, {
                headers: { "content-type": "text/html; charset=utf-8" },
              });
            },
          });

          if (result === "next") {
            if (shouldServeDocument(webRequest)) {
              writeHtmlResponse(
                response,
                await createDevDocument(server, options, manifest, webRequest),
              );
              return;
            }

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

  return `import { hydrateFileRouter } from "demiurge";
${stylesImport}

const routeModules = import.meta.glob(${JSON.stringify(routesGlob)});
const routePrefix = ${JSON.stringify(routesPrefix)};
const routes = Object.fromEntries(
  Object.entries(routeModules).map(([file, load]) => [
    \`./routes/\${file.slice(routePrefix.length)}\`,
    load,
  ]),
);

void hydrateFileRouter({ routes });
`;
}

export function createServerEntrySource(
  root: string,
  options: DemiurgeVitePluginOptions = {},
) {
  const routesDir = options.routesDir ?? "src/routes";
  const routesGlob = toRootAbsoluteGlob(routesDir);
  const routesPrefix = toRootAbsolutePrefix(routesDir);

  return `import { createRequestHandler } from "demiurge";

const routeModules = import.meta.glob(${JSON.stringify(routesGlob)});
const routePrefix = ${JSON.stringify(routesPrefix)};
export const routes = Object.fromEntries(
  Object.entries(routeModules).map(([file, load]) => [
    \`./routes/\${file.slice(routePrefix.length)}\`,
    load,
  ]),
);

export function createHandler(options = {}) {
  return createRequestHandler({
    routes,
    ssr: {
      lang: ${JSON.stringify(options.document?.lang)},
      title: ${JSON.stringify(options.document?.title)},
      ...options,
    },
  });
}
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
  manifest?: RouteManifest,
  request?: Request,
) {
  const match = manifest && request
    ? await loadDevPageRoute(manifest, request)
    : undefined;
  const html = match
    ? renderPageDocument(match, {
      clientEntry: `/${CLIENT_ENTRY_ID}`,
      lang: options.document?.lang,
      title: options.document?.title,
    })
    : createDocumentHtml({
      entrySrc: `/${CLIENT_ENTRY_ID}`,
      lang: options.document?.lang,
      title: options.document?.title,
    });

  return await server.transformIndexHtml("/", html);
}

async function loadDevPageRoute(manifest: RouteManifest, request: Request) {
  const url = new URL(request.url);
  const result = await loadPageRoute(manifest, url.pathname, request);

  return result.status === "ready" ? result.match : undefined;
}

export function createDocumentHtml({
  entrySrc,
  lang,
  links,
  metadata,
  nonce,
  scripts,
  styles,
  title,
}: {
  entrySrc: string;
  lang?: string;
  links?: LinkTag[];
  metadata?: ResolvedMetadata;
  nonce?: string;
  scripts?: ScriptTag[];
  styles?: string[];
  title?: string;
}) {
  return renderDocument({
    entrySrc,
    lang,
    links,
    metadata,
    nonce,
    scripts,
    styles,
    title,
  });
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
  options: {
    renderPage?: import("../server").PageRenderer;
  } = {},
) {
  const url = new URL(request.url);
  const routeMatch = findRouteMatch(manifest.routes, url.pathname);

  if (!routeMatch) {
    return "next" as const;
  }

  return await handleRequestWithManifest(manifest, request, {
    renderPage: options.renderPage,
  });
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
