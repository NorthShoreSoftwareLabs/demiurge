import { existsSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve, relative, sep } from "node:path";
import MagicString from "magic-string";
import {
  type ConfigEnv,
  parseAst,
  type Plugin,
  type UserConfig,
  type ViteDevServer,
} from "vite";
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
import { createCspNonce } from "../security/policy";
import {
  verifyRoutePolicyFile,
  type StaticPolicyFinding,
} from "./policy-verification";

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
const DEV_CLIENT_ENTRY_PATH = `/@id/${CLIENT_ENTRY_ID}`;
const RESOLVED_CLIENT_ENTRY_ID = `\0${CLIENT_ENTRY_ID}`;
const SERVER_ENTRY_ID = "virtual:demiurge/server-entry";
const RESOLVED_SERVER_ENTRY_ID = `\0${SERVER_ENTRY_ID}`;
const DEFAULT_TYPED_ROUTES_OUTPUT = ".demiurge/route-manifest.d.ts";
export function demiurge(options: DemiurgeVitePluginOptions = {}): Plugin {
  let root = process.cwd();
  let isBuild = false;
  const viteNoncePlaceholder = `demiurge-${createCspNonce()}`;

  return {
    enforce: "post",
    name: "demiurge",
    config(config, environment) {
      return createViteConfig(config, environment, viteNoncePlaceholder);
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
        if (!isRouteSource(root, options, id)) {
          return null;
        }

        if (transformOptions?.ssr) {
          return isBuild ? null : protectSsrImportMeta(code, id);
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
        const findings = await verifyRoutePolicies(root, options);

        if (findings.length) {
          throw new Error(formatStaticPolicyFindings(findings));
        }
      }

      if (!options.typedRoutes) {
        return;
      }

      await generateTypedRoutes(root, options);
    },
    configureServer(server) {
      const reportPolicyFindings = async () => {
        const findings = await verifyRoutePolicies(server.config.root, options);

        for (const finding of findings) {
          server.config.logger.warn(formatStaticPolicyFinding(finding));
        }
      };
      const startPolicyVerification = () => {
        void reportPolicyFindings().catch(() => {
          // Vite reports route read and syntax errors through its module pipeline.
        });
      };

      startPolicyVerification();
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
            startPolicyVerification();
          }
        });
        server.watcher.on("change", (file) => {
          if (isRouteFile(routesDir, file)) {
            void generateTypedRoutes(server.config.root, options);
            startPolicyVerification();
          }
        });
        server.watcher.on("unlink", (file) => {
          if (isRouteFile(routesDir, file)) {
            void generateTypedRoutes(server.config.root, options);
            startPolicyVerification();
          }
        });
      } else {
        const routesDir = resolve(
          server.config.root,
          options.routesDir ?? "src/routes",
        );
        server.watcher.add(routesDir);
        for (const event of ["add", "change", "unlink"] as const) {
          server.watcher.on(event, (file) => {
            if (isRouteFile(routesDir, file)) startPolicyVerification();
          });
        }
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
          const documentSecurity = createDevDocumentSecurity(
            server,
            viteNoncePlaceholder,
          );
          const result = await handleDevRequest(
            manifest,
            webRequest,
            createDevRuntimeOptions(options, documentSecurity.transform),
          );

          if (result === "next") {
            // Vite owns its own asset URLs, so an unmatched request still
            // falls through. The post middleware below is what turns whatever
            // Vite could not serve into the same negotiated not-found
            // production returns.
            next();
            return;
          }

          applyDevDocumentSecurity(result, documentSecurity.nonce);
          await writeWebResponse(response, result);
        } catch (error) {
          next(error);
        }
      });

      // The returned hook registers this after the Vite middleware. It sees
      // only requests that Vite cannot serve. `appType` is "custom", so no SPA
      // fallback intercepts these requests. Development and production render
      // the same negotiated not-found response for an unmatched path.
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

            const documentSecurity = createDevDocumentSecurity(
              server,
              viteNoncePlaceholder,
            );
            const notFoundResponse = await renderNotFoundResponse(
              manifest,
              webRequest,
              createDevFallbackOptions(options, documentSecurity.transform),
            );
            applyDevDocumentSecurity(
              notFoundResponse,
              documentSecurity.nonce,
            );
            await writeWebResponse(response, notFoundResponse);
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

// Vite 6 treats the `meta` token in `import.meta` as an imported reference.
// Give an imported `meta` binding a private name before development SSR runs.
function protectSsrImportMeta(code: string, id: string) {
  if (!code.includes("import.meta")) {
    return null;
  }

  const ast = parseAst(code) as unknown as AstNode;
  const declaration = asNodeArray(ast.body).find((node) =>
    node.type === "ImportDeclaration" &&
    asNodeArray(node.specifiers).some((specifier) =>
      asNode(specifier.local)?.type === "Identifier" &&
      asNode(specifier.local)?.name === "meta"
    )
  );
  const specifier = declaration &&
    asNodeArray(declaration.specifiers).find((candidate) =>
      asNode(candidate.local)?.type === "Identifier" &&
      asNode(candidate.local)?.name === "meta"
    );
  const local = specifier && asNode(specifier.local);

  if (!declaration || !specifier || !local) {
    return null;
  }

  let alias = "__demiurge_imported_meta__";
  while (new RegExp(`\\b${alias}\\b`).test(code)) {
    alias += "_";
  }

  const editor = new MagicString(code);
  const imported = asNode(specifier.imported);
  editor.overwrite(
    local.start,
    local.end,
    imported?.start === local.start ? `meta as ${alias}` : alias,
  );
  editor.appendLeft(declaration.end, `\nconst meta = ${alias};`);

  return {
    code: editor.toString(),
    map: editor.generateMap({
      hires: "boundary",
      includeContent: true,
      source: id,
    }),
  };
}

// Page data and document contributions are server capabilities. Vite and React
// first parse TypeScript and JSX. The plugin then removes these capabilities
// before Rollup follows the final client graph. This sequence excludes request
// code and server-only imports from browser chunks. The exported document
// bindings remain as `undefined` so the
// route module keeps a stable shape without evaluating their initializers.
export function stripClientPageData(code: string) {
  const ast = parseAst(code) as unknown as AstNode;
  const dataRanges: Array<{ end: number; start: number }> = [];
  const documentRanges = findDocumentContributionRanges(ast);
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

  const serverRanges = [...dataRanges, ...documentRanges];

  if (serverRanges.length === 0) {
    return code;
  }

  const removalRanges = [...serverRanges];
  for (const declaration of serverImports) {
    const localNames = asNodeArray(declaration.specifiers)
      .map((specifier) => asNode(specifier.local))
      .filter((local): local is AstNode => local?.type === "Identifier")
      .map((local) => String(local.name));
    const masked = maskRanges(code, [
      ...serverRanges,
      { end: declaration.end, start: declaration.start },
    ]);
    const leakedName = localNames.find((name) =>
      new RegExp(`\\b${escapeRegExp(name)}\\b`).test(masked)
    );

    if (leakedName) {
      throw new Error(
        `Server-only import ${JSON.stringify(leakedName)} is used by client route code. Move that use into page data, a document contribution, or a client-safe module.`,
      );
    }

    removalRanges.push({ end: declaration.end, start: declaration.start });
  }

  return replaceRanges(code, removalRanges, (range) =>
    dataRanges.includes(range) ? "data: undefined" :
      documentRanges.includes(range) ? "undefined" : ""
  );
}

const documentContributionNames = new Set(["links", "metadata", "scripts"]);

function findDocumentContributionRanges(ast: AstNode) {
  const exportedLocals = new Set<string>();

  for (const statement of asNodeArray(ast.body)) {
    if (statement.type !== "ExportNamedDeclaration") continue;

    const declaration = asNode(statement.declaration);
    if (declaration?.type === "VariableDeclaration") {
      for (const declarator of asNodeArray(declaration.declarations)) {
        const id = asNode(declarator.id);
        if (
          id?.type === "Identifier" &&
          documentContributionNames.has(String(id.name))
        ) {
          exportedLocals.add(String(id.name));
        }
      }
    }

    for (const specifier of asNodeArray(statement.specifiers)) {
      const exported = propertyName(specifier.exported);
      const local = propertyName(specifier.local);
      if (exported && local && documentContributionNames.has(exported)) {
        exportedLocals.add(local);
      }
    }
  }

  const ranges: Array<{ end: number; start: number }> = [];
  walkAst(ast, (node) => {
    if (node.type !== "VariableDeclarator") return;
    const id = asNode(node.id);
    const init = asNode(node.init);
    if (
      id?.type === "Identifier" &&
      exportedLocals.has(String(id.name)) &&
      init
    ) {
      ranges.push({ end: init.end, start: init.start });
    }
  });

  return ranges;
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

function createViteConfig(
  config: UserConfig,
  environment: ConfigEnv,
  viteNoncePlaceholder: string,
): UserConfig {
  return {
    appType: "custom",
    build: {
      assetsInlineLimit: config.build?.assetsInlineLimit ?? 0,
      ...(environment.isSsrBuild &&
          config.build?.target === undefined &&
          config.ssr?.target !== "webworker"
        ? { target: "node22.13" }
        : {}),
      rollupOptions: {
        input: config.build?.rollupOptions?.input ?? CLIENT_ENTRY_ID,
      },
    },
    ...(environment.command === "serve"
      ? { html: { cspNonce: viteNoncePlaceholder } }
      : {}),
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
    eagerModules: true,
  })}

export function createHandler(options = {}) {
  const { clientEntry, lang, styles, title, ...handlerOptions } = options;

  return createRequestHandler({
    ...handlerOptions,
    routes,
    routeModules,
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

// Both virtual entries use this function. Therefore, their prefix removal and
// route-key formats stay equal. The server entry requires framework-attached
// `.ts` files such as `@policy.ts` and `@middleware.ts`. Previously, a
// `.tsx`-only glob omitted these files from production. Development still found
// and applied them.
function createRouteMapSource(
  routesDir: string,
  {
    exportRoutes,
    eagerModules = false,
    includeServerOnly,
  }: {
    eagerModules?: boolean;
    exportRoutes: boolean;
    includeServerOnly: boolean;
  },
) {
  const routesGlobs = toRootAbsoluteGlobs(routesDir, includeServerOnly);
  const routesPrefix = toRootAbsolutePrefix(routesDir);

  return eagerModules
    ? `const eagerRouteModules = import.meta.glob(${JSON.stringify(routesGlobs)}, { eager: true });
const routePrefix = ${JSON.stringify(routesPrefix)};
export const routeModules = Object.fromEntries(
  Object.entries(eagerRouteModules).map(([file, module]) => [
    \`./routes/\${file.slice(routePrefix.length)}\`,
    module,
  ]),
);
${exportRoutes ? "export " : ""}const routes = Object.fromEntries(
  Object.entries(routeModules).map(([file, module]) => [
    file,
    async () => module,
  ]),
);`
    : `const routeModules = import.meta.glob(${JSON.stringify(routesGlobs)});
const routePrefix = ${JSON.stringify(routesPrefix)};
${exportRoutes ? "export " : ""}const routes = Object.fromEntries(
  Object.entries(routeModules).map(([file, load]) => [
    \`./routes/\${file.slice(routePrefix.length)}\`,
    load,
  ]),
);`;
}

// These two files run only on the server. They control a request before the
// route runs and do not render. A client glob would create public chunks in
// `dist/client`. These chunks could expose credentials, authorization logic, or
// internal host names from a middleware or policy closure.
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

// Development renders through the production pipeline. It adds the virtual
// client entry, the Vite HTML transform, and a development flag for stack
// traces. The shared handler makes all security and routing decisions.
function createDevRuntimeOptions(
  options: DemiurgeVitePluginOptions,
  transformDocument: (html: string) => Promise<string>,
) {
  return {
    dev: true,
    ssr: createDevSsrOptions(options),
    transformDocument,
    renderPage: async (
      match: Parameters<PageRenderer>[0],
      renderOptions: Parameters<PageRenderer>[1],
    ) => {
      if (match.render.mode === "streaming") {
        return await renderStreamingPageResponse(match, {
          ...renderOptions,
          clientEntry: DEV_CLIENT_ENTRY_PATH,
          transformDocument,
        });
      }

      const html = await transformDocument(
        renderPageDocument(match, {
          ...renderOptions,
          clientEntry: DEV_CLIENT_ENTRY_PATH,
        }),
      );

      return new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  };
}

function createDevDocumentSecurity(
  server: ViteDevServer,
  viteNoncePlaceholder: string,
) {
  const nonce = createCspNonce();
  const shieldNonce = createCspNonce();

  return {
    nonce,
    transform: async (html: string) => {
      const shielded = shieldViteNonceTargets(html, shieldNonce);
      const transformed = await server.transformIndexHtml("/", shielded);

      return replaceNonceAttribute(
        replaceNonceAttribute(transformed, shieldNonce),
        viteNoncePlaceholder,
        nonce,
      );
    },
  };
}

function shieldViteNonceTargets(html: string, nonce: string) {
  const lowerHtml = html.toLowerCase();
  let cursor = 0;
  let output = "";

  while (cursor < html.length) {
    const tagStart = html.indexOf("<", cursor);

    if (tagStart === -1) {
      return output + html.slice(cursor);
    }

    output += html.slice(cursor, tagStart);

    if (lowerHtml.startsWith("<!--", tagStart)) {
      const commentEnd = lowerHtml.indexOf("-->", tagStart + 4);
      const end = commentEnd === -1 ? html.length : commentEnd + 3;
      output += html.slice(tagStart, end);
      cursor = end;
      continue;
    }

    const name = lowerHtml.slice(tagStart).match(/^<\s*(script|style|link)\b/)?.[1];

    if (!name) {
      output += "<";
      cursor = tagStart + 1;
      continue;
    }

    const tagEnd = findHtmlTagEnd(html, tagStart);

    if (tagEnd === -1) {
      return output + html.slice(tagStart);
    }

    const openingTag = html.slice(tagStart, tagEnd + 1);
    output += /(?:^|\s)nonce(?:\s|=|>)/i.test(openingTag)
      ? openingTag
      : addNonceAttribute(openingTag, nonce);
    cursor = tagEnd + 1;

    if (name === "script" || name === "style") {
      const closeStart = lowerHtml.indexOf(`</${name}`, cursor);

      if (closeStart === -1) {
        return output + html.slice(cursor);
      }

      output += html.slice(cursor, closeStart);
      cursor = closeStart;
    }
  }

  return output;
}

function findHtmlTagEnd(html: string, start: number) {
  let quote: "\"" | "'" | undefined;

  for (let index = start + 1; index < html.length; index++) {
    const character = html[index];

    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }

    if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }

  return -1;
}

function addNonceAttribute(openingTag: string, nonce: string) {
  const insertion = /\/\s*>$/.test(openingTag)
    ? openingTag.lastIndexOf("/")
    : openingTag.length - 1;

  return `${openingTag.slice(0, insertion)} nonce="${nonce}"${openingTag.slice(insertion)}`;
}

function replaceNonceAttribute(
  html: string,
  current: string,
  replacement?: string,
) {
  const pattern = new RegExp(
    `(\\snonce\\s*=\\s*)(["'])${escapeRegExp(current)}\\2`,
    "g",
  );

  return html.replace(
    pattern,
    replacement ? `$1"${replacement}"` : "",
  );
}

function applyDevDocumentSecurity(response: Response, nonce: string) {
  const contentType = response.headers.get("content-type");
  const csp = response.headers.get("content-security-policy");

  if (!contentType?.toLowerCase().startsWith("text/html") || !csp) {
    return;
  }

  const source = `'nonce-${nonce}'`;
  const withScriptNonce = addCspSource(
    csp,
    ["script-src-elem", "script-src"],
    "script-src",
    source,
  );
  const withStyleNonce = allowsUnsafeInline(
      withScriptNonce,
      ["style-src-elem", "style-src"],
    )
    ? withScriptNonce
    : addCspSource(
      withScriptNonce,
      ["style-src-elem", "style-src"],
      "style-src",
      source,
    );

  response.headers.set("content-security-policy", withStyleNonce);
  response.headers.set("cache-control", "private, no-store");
}

function addCspSource(
  csp: string,
  directiveNames: readonly string[],
  fallbackDirectiveName: "script-src" | "style-src",
  source: string,
) {
  const directives = csp.split(";").map((directive) => directive.trim());
  const directiveIndex = findCspDirectiveIndex(directives, directiveNames);

  const defaultDirective = directives.find((directive) =>
    directive.split(/\s+/, 1)[0]?.toLowerCase() === "default-src"
  );

  if (directiveIndex === -1 && !defaultDirective) return csp;

  const [currentName, ...currentSources] =
    (directiveIndex === -1 ? defaultDirective! : directives[directiveIndex]!)
      .split(/\s+/);
  const updatedDirective = [
    directiveIndex === -1 ? fallbackDirectiveName : currentName!,
    ...new Set([
      ...currentSources.filter((current) => current !== "'none'"),
      source,
    ]),
  ].join(" ");

  if (directiveIndex === -1) {
    directives.push(updatedDirective);
  } else {
    directives[directiveIndex] = updatedDirective;
  }

  return directives.join("; ");
}

function allowsUnsafeInline(
  csp: string,
  directiveNames: readonly string[],
) {
  const directives = csp.split(";").map((directive) => directive.trim());
  const directiveIndex = findCspDirectiveIndex(directives, directiveNames);
  const effectiveDirective = directiveIndex === -1
    ? directives.find((directive) =>
      directive.split(/\s+/, 1)[0]?.toLowerCase() === "default-src"
    )
    : directives[directiveIndex];
  const sources = effectiveDirective?.split(/\s+/).slice(1) ?? [];

  return sources.includes("'unsafe-inline'") &&
    !sources.some((source) => /^'(?:nonce-|sha(?:256|384|512)-)/i.test(source));
}

function findCspDirectiveIndex(
  directives: readonly string[],
  directiveNames: readonly string[],
) {
  for (const name of directiveNames) {
    const index = directives.findIndex((directive) =>
      directive.split(/\s+/, 1)[0]?.toLowerCase() === name
    );

    if (index !== -1) return index;
  }

  return -1;
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
    clientEntry: DEV_CLIENT_ENTRY_PATH,
    lang: options.document?.lang,
    title: options.document?.title,
  };
}

function createDevFallbackOptions(
  options: DemiurgeVitePluginOptions,
  transformDocument: (html: string) => Promise<string>,
) {
  return {
    ...createDevSsrOptions(options),
    dev: true,
    transformDocument,
  };
}

const warnedRoots = new Set<string>();

// The framework built-in is a temporary fallback, not a production 404. The
// build gate enforces this rule. This warning gives the same message earlier.
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

// The plugin cannot evaluate route modules during the build. Therefore, page
// detection reads the source. It checks the import, not only the word. An API
// application can call `db.users.page(2)` without serving an HTML document.
// Only a page route imports `page` from the framework package.
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

export async function verifyRoutePolicies(
  root: string,
  options: DemiurgeVitePluginOptions = {},
) {
  const routesDir = resolve(root, options.routesDir ?? "src/routes");

  if (!existsSync(routesDir)) return [];
  const findings = (await Promise.all(
    (await findRouteFiles(routesDir)).map(verifyRoutePolicyFile),
  )).flat();

  return findings.sort((left, right) =>
    left.file.localeCompare(right.file) ||
    (left.exportName ?? "").localeCompare(right.exportName ?? "") ||
    left.code.localeCompare(right.code)
  );
}

export function formatStaticPolicyFindings(findings: StaticPolicyFinding[]) {
  return [
    "Demiurge found invalid static route policy:",
    ...findings.map(formatStaticPolicyFinding),
  ].join("\n");
}

function formatStaticPolicyFinding(finding: StaticPolicyFinding) {
  const source = finding.exportName
    ? `${finding.file} export ${finding.exportName}`
    : finding.file;
  return `${source}: [${finding.code}] ${finding.message}`;
}

function toRouteKey(routesDir: string, file: string) {
  const relativePath = relative(routesDir, file).split(sep).join("/");
  return `./routes/${relativePath}`;
}
