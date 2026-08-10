import { existsSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { readdir } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
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
  type RouteManifest,
} from "../router";
import {
  handleRequestWithManifest,
  renderNotFoundResponse,
  renderPageDocument,
  type PageRenderer,
} from "../server";
import {
  type RouteImporter,
  type RouteModule,
} from "../route";
import {
  UnsupportedMethodError,
  toWebRequest,
  writeNotImplemented,
  writeWebResponse,
} from "../node/http";

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
          let webRequest: Request;

          try {
            webRequest = toWebRequest(request);
          } catch (error) {
            if (error instanceof UnsupportedMethodError) {
              writeNotImplemented(response);
              return;
            }

            throw error;
          }

          const routesDir = resolve(
            server.config.root,
            options.routesDir ?? "src/routes",
          );
          const manifest = await loadDevManifest(server, request, routesDir);
          const result = await handleDevRequest(
            manifest,
            webRequest,
            createDevRuntimeOptions(server, options),
          );

          if (result === "next") {
            // Vite owns its own asset URLs, so an unmatched request still
            // falls through. The post middleware below is what turns whatever
            // Vite could not serve into the same negotiated not-found
            // production returns.
            next();
            return;
          }

          await writeWebResponse(response, result);
        } catch (error) {
          next(error);
        }
      });

      // Returning a hook registers this after Vite's own middlewares, so it
      // only sees requests Vite could not serve either. `appType` is
      // "custom", so no SPA fallback intercepts them first. This is what makes
      // dev and production agree on an unmatched path: both render the same
      // negotiated not-found instead of dev handing back a bodiless shell.
      return () => {
        server.middlewares.use(async (request, response, next) => {
          try {
            let webRequest: Request;

            try {
              webRequest = toWebRequest(request);
            } catch (error) {
              if (error instanceof UnsupportedMethodError) {
                writeNotImplemented(response);
                return;
              }

              throw error;
            }

            const routesDir = resolve(
              server.config.root,
              options.routesDir ?? "src/routes",
            );
            const manifest = await loadDevManifest(server, request, routesDir);

            await writeWebResponse(
              response,
              await renderNotFoundResponse(
                manifest,
                webRequest,
                createDevFallbackOptions(server, options),
              ),
            );
          } catch (error) {
            next(error);
          }
        });
      };
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
  const stylesImport = createStylesImport(root, options);

  return `import { hydrateFileRouter } from "demiurge";
${stylesImport}

${createRouteMapSource(routesDir, {
    exportRoutes: false,
    includeServerOnly: false,
  })}

void hydrateFileRouter({ routes });
`;
}

export function createServerEntrySource(
  root: string,
  options: DemiurgeVitePluginOptions = {},
) {
  const routesDir = options.routesDir ?? "src/routes";

  return `import { createRequestHandler } from "demiurge";

${createRouteMapSource(routesDir, {
    exportRoutes: true,
    includeServerOnly: true,
  })}

export function createHandler(options = {}) {
  const { clientEntry, lang, styles, title, ...handlerOptions } = options;

  return createRequestHandler({
    ...handlerOptions,
    routes,
    ssr: {
      clientEntry,
      lang: lang ?? ${JSON.stringify(options.document?.lang)},
      styles,
      title: title ?? ${JSON.stringify(options.document?.title)},
    },
  });
}
`;
}

// Shared by both virtual entries so the prefix stripping and the route-key
// shape can never drift between them the way they did before: the server
// entry needs framework-attached `.ts` files such as `@policy.ts` and
// `@middleware.ts`, which the old `.tsx`-only glob silently dropped from
// production while dev's own `findRouteFiles` kept enforcing them.
function createRouteMapSource(
  routesDir: string,
  {
    exportRoutes,
    includeServerOnly,
  }: { exportRoutes: boolean; includeServerOnly: boolean },
) {
  const routesGlobs = toRootAbsoluteGlobs(routesDir, includeServerOnly);
  const routesPrefix = toRootAbsolutePrefix(routesDir);

  return `const routeModules = import.meta.glob(${JSON.stringify(routesGlobs)});
const routePrefix = ${JSON.stringify(routesPrefix)};
${exportRoutes ? "export " : ""}const routes = Object.fromEntries(
  Object.entries(routeModules).map(([file, load]) => [
    \`./routes/\${file.slice(routePrefix.length)}\`,
    load,
  ]),
);`;
}

// These two run only on the server: they gate a request before the route is
// invoked and never render. Globbing them into the client entry emits them as
// fetchable chunks in `dist/client`, publishing whatever a middleware or
// policy closes over — credentials, auth logic, internal hostnames — to
// anyone who reads the asset directory.
const serverOnlyRouteFiles = ["@middleware.ts", "@policy.ts"];

function toRootAbsoluteGlobs(routesDir: string, includeServerOnly: boolean) {
  const base = `/${routesDir.replace(/^\/|\/$/g, "")}`;
  const globs = [`${base}/**/*.{ts,tsx}`];

  if (!includeServerOnly) {
    globs.push(
      ...serverOnlyRouteFiles.flatMap((fileName) => [
        `!${base}/${fileName}`,
        `!${base}/**/${fileName}`,
      ]),
    );
  }

  return globs;
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

// Dev renders through the production pipeline, so the only things it adds are
// the virtual client entry, Vite's HTML transform, and the dev flag that turns
// on stack traces. Every security and routing decision comes from the shared
// handler.
function createDevRuntimeOptions(
  server: ViteDevServer,
  options: DemiurgeVitePluginOptions,
) {
  return {
    dev: true,
    ssr: createDevSsrOptions(options),
    transformDocument: (html: string) => server.transformIndexHtml("/", html),
    renderPage: async (
      match: Parameters<PageRenderer>[0],
      renderOptions: Parameters<PageRenderer>[1],
    ) => {
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
  };
}

// Both dev middlewares need the manifest for the same request, and building
// it walks the routes directory. The pre middleware always runs, so the post
// middleware reuses what it already produced rather than scanning twice on
// every unmatched request.
const DEV_MANIFEST = Symbol.for("demiurge.devManifest");

type DevManifestCarrier = { [DEV_MANIFEST]?: RouteManifest };

async function loadDevManifest(
  server: ViteDevServer,
  request: IncomingMessage,
  routesDir: string,
) {
  const carrier = request as IncomingMessage & DevManifestCarrier;
  const cached = carrier[DEV_MANIFEST];

  if (cached) {
    return cached;
  }

  const manifest = createRouteManifest(
    await createDevRouteImporters(server, routesDir),
  );

  carrier[DEV_MANIFEST] = manifest;

  return manifest;
}

function createDevSsrOptions(options: DemiurgeVitePluginOptions) {
  return {
    clientEntry: `/${CLIENT_ENTRY_ID}`,
    lang: options.document?.lang,
    title: options.document?.title,
  };
}

function createDevFallbackOptions(
  server: ViteDevServer,
  options: DemiurgeVitePluginOptions,
) {
  return {
    ...createDevSsrOptions(options),
    dev: true,
    transformDocument: (html: string) => server.transformIndexHtml("/", html),
  };
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
  options: Parameters<typeof handleRequestWithManifest>[2] = {},
) {
  const url = new URL(request.url);
  const routeMatch = findRouteMatch(manifest.routes, url.pathname);

  if (!routeMatch) {
    return "next" as const;
  }

  return await handleRequestWithManifest(manifest, request, options);
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
