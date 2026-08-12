import { existsSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve, relative, sep } from "node:path";
import { parseAst, type Plugin, type UserConfig, type ViteDevServer } from "vite";
import { renderDocument } from "../document";
import type {
  LinkTag,
  ResolvedMetadata,
  ScriptTag,
} from "../document";
import { PACKAGE_NAME } from "../package-name";
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
import { renderStreamingPageResponse } from "../node/streaming";

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
  let isBuild = false;

  return {
    enforce: "post",
    name: "demiurge",
    config(config) {
      return createViteConfig(config);
    },
    configResolved(config) {
      root = config.root;
      isBuild = config.command === "build";
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
    transform: {
      order: "post",
      handler(code, id, transformOptions) {
        if (transformOptions?.ssr || !isRouteSource(root, options, id)) {
          return null;
        }

        const transformed = stripClientPageData(code);
        return transformed === code ? null : { code: transformed, map: null };
      },
    },
    generateBundle(_outputOptions, bundle) {
      const entry = Object.values(bundle).find(
        (item) =>
          item.type === "chunk" &&
          item.isEntry &&
          item.facadeModuleId === RESOLVED_CLIENT_ENTRY_ID,
      );

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
      if (isBuild) {
        await assertRootNotFoundRoute(root, options);
      }

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
            webRequest = toWebRequest(request, {
              // Vite performs its own configured host allowlist check before
              // Demiurge's middleware runs. Production Node listeners require
              // an explicit application allowlist instead.
              allowedHosts: [request.headers.host ?? "localhost"],
            });
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
              webRequest = toWebRequest(request, {
                allowedHosts: [request.headers.host ?? "localhost"],
              });
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

            warnMissingRootNotFound(manifest, routesDir);

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

type AstNode = {
  [key: string]: unknown;
  end: number;
  start: number;
  type: string;
};

// Page data is a server capability. Removing it after Vite/React have parsed
// TypeScript and JSX, but before Rollup follows the final client graph, keeps
// request code and its data-only imports out of browser chunks.
export function stripClientPageData(code: string) {
  const ast = parseAst(code) as unknown as AstNode;
  const dataRanges: Array<{ end: number; start: number }> = [];
  const serverImports: AstNode[] = [];

  walkAst(ast, (node) => {
    if (node.type === "ImportDeclaration" && isServerOnlyImport(node)) {
      serverImports.push(node);
      return;
    }

    if (node.type !== "CallExpression" || !isPageCallee(node.callee)) {
      return;
    }

    const argument = asNodeArray(node.arguments)[0];
    if (argument?.type !== "ObjectExpression") {
      return;
    }

    for (const property of asNodeArray(argument.properties)) {
      if (property.type === "Property" && propertyName(property.key) === "data") {
        dataRanges.push({ end: property.end, start: property.start });
      }
    }
  });

  if (dataRanges.length === 0) {
    return code;
  }

  const removalRanges = [...dataRanges];
  for (const declaration of serverImports) {
    const localNames = asNodeArray(declaration.specifiers)
      .map((specifier) => asNode(specifier.local))
      .filter((local): local is AstNode => local?.type === "Identifier")
      .map((local) => String(local.name));
    const masked = maskRanges(code, [
      ...dataRanges,
      { end: declaration.end, start: declaration.start },
    ]);
    const leakedName = localNames.find((name) =>
      new RegExp(`\\b${escapeRegExp(name)}\\b`).test(masked)
    );

    if (leakedName) {
      throw new Error(
        `Server-only import ${JSON.stringify(leakedName)} is used by client route code. Move that use into the page data function or a client-safe module.`,
      );
    }

    removalRanges.push({ end: declaration.end, start: declaration.start });
  }

  return replaceRanges(code, removalRanges, (range) =>
    dataRanges.includes(range) ? "data: undefined" : ""
  );
}

function isRouteSource(
  root: string,
  options: DemiurgeVitePluginOptions,
  id: string,
) {
  const file = id.split("?", 1)[0] ?? id;
  const routesRoot = resolve(root, options.routesDir ?? "src/routes");
  const pathFromRoutes = relative(routesRoot, file);
  return pathFromRoutes !== "" &&
    pathFromRoutes !== ".." &&
    !pathFromRoutes.startsWith(`..${sep}`);
}

function walkAst(value: unknown, visit: (node: AstNode) => void) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walkAst(item, visit);
    return;
  }

  const node = value as Partial<AstNode>;
  if (typeof node.type !== "string") return;
  visit(node as AstNode);
  for (const [key, child] of Object.entries(node)) {
    if (!new Set(["end", "loc", "start", "type"]).has(key)) {
      walkAst(child, visit);
    }
  }
}

function asNode(value: unknown) {
  return value && typeof value === "object" && "type" in value
    ? value as AstNode
    : undefined;
}

function asNodeArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(asNode).filter((node): node is AstNode => Boolean(node))
    : [];
}

function isPageCallee(value: unknown) {
  const callee = asNode(value);
  if (callee?.type === "Identifier") return callee.name === "page";
  return callee?.type === "MemberExpression" &&
    propertyName(callee.property) === "page";
}

function propertyName(value: unknown) {
  const property = asNode(value);
  return property?.type === "Identifier" || property?.type === "Literal"
    ? String(property.name ?? property.value)
    : undefined;
}

function isServerOnlyImport(node: AstNode) {
  const source = asNode(node.source)?.value;
  return typeof source === "string" &&
    /(?:^|[/.-])server(?:[/.-]|$)/.test(source);
}

function maskRanges(code: string, ranges: Array<{ end: number; start: number }>) {
  const characters = [...code];
  for (const { end, start } of ranges) {
    characters.fill(" ", start, end);
  }
  return characters.join("");
}

function replaceRanges(
  code: string,
  ranges: Array<{ end: number; start: number }>,
  replacement: (range: { end: number; start: number }) => string,
) {
  return [...ranges]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (result, range) =>
        `${result.slice(0, range.start)}${replacement(range)}${result.slice(range.end)}`,
      code,
    );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

  return `import { hydrateFileRouter } from "${PACKAGE_NAME}";
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

  return `import { createRequestHandler } from "${PACKAGE_NAME}";

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
      if (match.render.mode === "streaming") {
        return await renderStreamingPageResponse(match, {
          ...renderOptions,
          clientEntry: `/${CLIENT_ENTRY_ID}`,
          transformDocument: (html) => server.transformIndexHtml("/", html),
        });
      }

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

const warnedRoots = new Set<string>();

// The framework built-in is a stopgap, not a 404 anyone should ship. The build
// gate is what enforces that; this is the same message arriving early enough
// to act on.
function warnMissingRootNotFound(manifest: RouteManifest, routesDir: string) {
  if (
    warnedRoots.has(routesDir) ||
    manifest.fallbacks.notFound.some(
      (fallback) => fallback.fileSegments.length === 0,
    )
  ) {
    return;
  }

  warnedRoots.add(routesDir);
  console.warn(missingRootNotFoundMessage(join(routesDir, "@not-found.tsx")));
}

// The framework ships a working 404 so nothing is ever blank, and refuses to
// let an app reach production still rendering it. A generic framework page in
// front of real users is a failure of the framework, not of the app that never
// got around to it.
export async function assertRootNotFoundRoute(
  root: string,
  options: DemiurgeVitePluginOptions = {},
) {
  const routesDirOption = options.routesDir ?? "src/routes";
  const routesDir = resolve(root, routesDirOption);

  if (!existsSync(routesDir)) {
    return;
  }

  const files = await findRouteFiles(routesDir);
  const names = files.map((file) =>
    relative(routesDir, file).split(sep).join("/"),
  );

  if (names.some((name) => /^@not-found\.tsx?$/.test(name))) {
    return;
  }

  const pageRoute = await findPageRouteFile(files);

  // An API-only app never wants an HTML not-found document, and nagging it
  // would be user hostile. It builds clean and gets problem+json.
  if (!pageRoute) {
    return;
  }

  throw new Error(
    missingRootNotFoundBuildMessage(
      routesDirOption,
      relative(routesDir, pageRoute).split(sep).join("/"),
    ),
  );
}

// Page detection is a source scan rather than a module evaluation: the plugin
// cannot execute route modules at build time. A page route is a file that
// calls `page(...)`, which is the only way to declare one.
async function findPageRouteFile(files: string[]) {
  for (const file of files) {
    // Framework-attached files own no address, so they are never page routes.
    if (relative(dirname(file), file).startsWith("@")) {
      continue;
    }

    if (declaresPageRoute(await readFile(file, "utf8"))) {
      return file;
    }
  }

  return undefined;
}

// Escaped because a package name may contain `.`, which the regex would
// otherwise read as a wildcard.
const PACKAGE_NAME_PATTERN = PACKAGE_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const DEMIURGE_NAMED_IMPORT = new RegExp(
  `import\\s*\\{([^}]*)\\}\\s*from\\s*["']${PACKAGE_NAME_PATTERN}["']`,
  "g",
);

// The plugin cannot evaluate route modules at build time, so page detection
// reads the source. The signal is the import rather than the bare word: an
// API-only app doing `db.users.page(2)` must never be told to write a 404
// document it will never serve, and pagination is everywhere in API code.
// Importing `page` from the framework package is the one thing only a page
// route does.
export function declaresPageRoute(source: string) {
  const locals = [...source.matchAll(DEMIURGE_NAMED_IMPORT)].flatMap((match) =>
    match[1].split(",").flatMap((binding) => {
      const [imported, local] = binding.trim().split(/\s+as\s+/);

      // `import type { page }` cannot be called, and an alias renames what the
      // call site looks like.
      return imported.replace(/^type\s+/, "") === "page"
        ? [local ?? imported]
        : [];
    }),
  );

  if (locals.length === 0) {
    return false;
  }

  // Strip the import statements first so the binding list is not itself
  // mistaken for a call.
  const body = source.replace(DEMIURGE_NAMED_IMPORT, "");

  return locals.some((local) => new RegExp(`\\b${local}\\s*\\(`).test(body));
}

export function missingRootNotFoundBuildMessage(
  routesDir: string,
  pageRoute: string,
) {
  return `Demiurge will not build an app with page routes and no ${routesDir}/@not-found.tsx.

"${pageRoute}" declares a page, so a browser can reach a path this app does not serve. Decide what that looks like rather than shipping the framework built-in.

Create ${routesDir}/@not-found.tsx:

  export default function NotFound({ pathname }: { pathname: string }) {
    return <h1>Nothing at {pathname}</h1>;
  }

It renders inside the layouts above the requested path. Opt out with "export const layout = false".`;
}

export function missingRootNotFoundMessage(notFoundFile: string) {
  return `Demiurge is serving its built-in 404 because ${notFoundFile} does not exist.

Create it before building for production:

  export default function NotFound({ pathname }: { pathname: string }) {
    return <h1>Nothing at {pathname}</h1>;
  }
`;
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
