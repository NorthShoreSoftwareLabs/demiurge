import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { defineAdapter } from "../adapter";
import { STRUCTURED_DATA_ATTRIBUTE } from "../document/render";
import {
  collectStaticRoutePaths,
  type RouteManifest,
} from "../router";
import type { RouteCapability, RouteImporter, RouteModule } from "../route";
import {
  handleRequestWithManifest,
  renderNotFoundResponse,
  type RequestErrorReporter,
  type SsrOptions,
} from "../server";
import {
  createMemoryRateLimitStore,
  createSecurityHeaders,
  cspHash,
  mergeSecurityPolicies,
  validateRouteModules,
  type SecurityHeaderPolicy,
  type SecurityPolicy,
} from "../security";
import {
  CONTENT_HASHED_FILE_NAME_PATTERN,
  IMMUTABLE_FILE_CACHE_CONTROL,
  REVALIDATED_FILE_CACHE_CONTROL,
} from "../static-files";
import { resolveFontAssets } from "../platform/font-assets";
import type { FontContribution } from "../platform/fonts";
import type { ImagePolicy } from "../platform/images";
import { assertNoOptimizerImages, emitImageVariants } from "./images";

const STATIC_MANIFEST_FILE = "demiurge-static-manifest.json";

export { createStaticPreviewServer } from "./preview";
export type { StaticPreviewOptions } from "./preview";
export {
  createVercelOutputConfig,
  generateVercelStaticOutput,
  vercelStatic,
} from "./vercel";
export type {
  VercelOutputConfig,
  VercelOutputRoute,
  VercelStaticDeployment,
  VercelStaticCacheRule,
  VercelStaticOptions,
} from "./vercel";

export const staticAdapter = defineAdapter({
  name: "static",
  capabilities: {
    staticOutput: true,
  },
});

export type StaticOutputEntry = {
  file: string;
  headers: Record<string, string>;
  pathname: string;
  status: 200 | 404;
};

export type StaticOutputManifest = {
  adapter: "static";
  entries: StaticOutputEntry[];
  fileHeaderRules: StaticOutputFileHeaderRule[];
  // Self-hosted font files and the stylesheet that declares them. They are
  // plain output files as well, so the framework file header rules cover them.
  fontFiles?: string[];
  // Optimized image files that the build emitted. They are plain output
  // files rather than route entries. A host therefore serves them with the
  // framework file header rules and no route rule of their own.
  imageFiles?: string[];
  // The normalized build origin. The Vercel static generator falls back to
  // this value for `access-control-allow-origin` when the deployment
  // declares no CORS policy of its own. A manifest that a caller builds by
  // hand, such as a static preview fixture, can omit this field.
  origin?: string;
  version: 1;
};

export type StaticOutputFileHeaderRule = {
  headers: Record<string, string>;
  pattern: string;
};

// A pattern rule declares the same typed `SecurityHeaderPolicy` as the root
// and route policies. One header keeps one spelling in every place that
// declares it. `pattern` is an ECMAScript regular expression tested against
// the file basename, the same convention as the framework's built-in file
// header rules.
export type StaticFileHeaderPatternRule = {
  headers: SecurityHeaderPolicy;
  pattern: string;
};

export type GenerateStaticOutputOptions = {
  // The font declaration that the application passed to the Vite plugin. The
  // build reads every source it names and publishes the file from this origin.
  fonts?: FontContribution;
  // The image policy that the application declared in the Vite plugin. The
  // build reads it to find and validate the variants it must emit.
  images?: ImagePolicy;
  onError?: RequestErrorReporter;
  origin?: string;
  outDir: string;
  // The project directory that a local font source resolves against. A font
  // file therefore does not have to sit in the public directory.
  root?: string;
  routes: Record<string, RouteImporter>;
  ssr?: SsrOptions;
  staticFileHeaders?: readonly StaticFileHeaderPatternRule[];
};

type PendingOutput = StaticOutputEntry & {
  body: string;
};

type PendingAsset = {
  body: Uint8Array;
  file: string;
};

type OutputKind = "document" | "resource";

type PlannedOutput = {
  file: string;
  kind: OutputKind;
  pathname: string;
};

const staticRouteLoadConcurrency = 8;

async function loadRouteModules(
  routes: Readonly<Record<string, RouteImporter>>,
) {
  const entries = Object.entries(routes);
  const modules = new Array<readonly [string, RouteModule]>(entries.length);
  let next = 0;

  const workers = Array.from(
    { length: Math.min(staticRouteLoadConcurrency, entries.length) },
    async () => {
      while (next < entries.length) {
        const index = next++;
        const [file, load] = entries[index]!;

        try {
          modules[index] = [file, await load()];
        } catch (error) {
          throw new Error(
            `Demiurge could not load route module ${JSON.stringify(file)}.`,
            { cause: error },
          );
        }
      }
    },
  );

  await Promise.all(workers);

  return Object.fromEntries(modules) as Record<string, RouteModule>;
}

export async function generateStaticOutput(
  options: GenerateStaticOutputOptions,
): Promise<StaticOutputManifest> {
  const routeModules = await loadRouteModules(options.routes);
  const manifest = validateRouteModules(routeModules, {
    adapter: staticAdapter,
  });

  const origin = normalizeOrigin(options.origin);
  const outDir = resolve(options.outDir);
  const routeKinds = await validateStaticRoutes(manifest);
  const paths = await collectStaticRoutePaths(manifest, {
    includeResources: true,
  });

  assertStaticPageApp(
    manifest,
    paths.filter((path) => routeKinds.get(path.file) === "document").length,
  );

  const outputEntries = planOutputEntries(
    paths.map((path) => ({
      kind: routeKinds.get(path.file) ?? "resource",
      pathname: path.pathname,
    })),
  );
  const rateLimitStore = createMemoryRateLimitStore();
  const pending: PendingOutput[] = [];
  const ssr = { ...options.ssr, navigation: "document" as const };

  for (const entry of outputEntries) {
    const request = createStaticRequest(origin, entry.pathname, entry.kind);
    const response = await handleRequestWithManifest(manifest, request, {
      onError: options.onError,
      rateLimitStore,
      ssr,
    });

    pending.push(
      entry.kind === "document"
        ? await prepareDocumentOutput(entry, response, 200)
        : await prepareResourceOutput(entry, response),
    );
  }

  const notFoundResponse = await renderNotFoundResponse(
    manifest,
    createStaticRequest(origin, "/404", "document"),
    {
      ...ssr,
      onError: (error, site) =>
        options.onError?.(error, { pathname: "/404", site }),
    },
  );
  pending.push(
    await prepareDocumentOutput(
      {
        file: "404.html",
        pathname: "*",
      },
      notFoundResponse,
      404,
    ),
  );

  const documents = pending.map((entry) => entry.body);

  assertNoOptimizerImages(documents, options.images);

  const images = await emitImageVariants({
    documents,
    outDir,
    policy: options.images,
  });
  // The font set is a declaration rather than a render result, so the build
  // publishes every font the application declared. A document reaches them
  // through the stylesheet that `fontLinks` adds.
  const fonts = await resolveFontAssets({
    fonts: options.fonts,
    root: options.root ?? process.cwd(),
  });

  pending.sort((left, right) => left.file.localeCompare(right.file));
  images.sort((left, right) => left.file.localeCompare(right.file));
  fonts.sort((left, right) => left.file.localeCompare(right.file));

  const outputManifest: StaticOutputManifest = {
    adapter: "static",
    entries: pending.map(({ body: _body, ...entry }) => entry),
    fileHeaderRules: await createStaticFileHeaderRules(
      manifest,
      options.staticFileHeaders ?? [],
    ),
    fontFiles: fonts.map((asset) => asset.file),
    imageFiles: images.map((image) => image.file),
    origin,
    version: 1,
  };

  await writeOutput(outDir, pending, [...images, ...fonts], outputManifest);

  return outputManifest;
}

async function createStaticFileHeaderRules(
  manifest: RouteManifest,
  patternRules: readonly StaticFileHeaderPatternRule[],
): Promise<StaticOutputFileHeaderRule[]> {
  const baseline = await loadBaselineFileSecurityPolicy(manifest);
  const baselineHeaders = renderStaticFileHeaders(baseline);

  return [
    ...patternRules.map((rule) => {
      assertValidFileHeaderPattern(rule.pattern);

      return {
        headers: renderStaticFileHeaders(
          mergeSecurityPolicies(baseline, { headers: rule.headers }),
        ),
        pattern: rule.pattern,
      };
    }),
    {
      headers: {
        ...baselineHeaders,
        "cache-control": IMMUTABLE_FILE_CACHE_CONTROL,
      },
      pattern: CONTENT_HASHED_FILE_NAME_PATTERN.source,
    },
    {
      headers: {
        ...baselineHeaders,
        "cache-control": REVALIDATED_FILE_CACHE_CONTROL,
      },
      pattern: ".*",
    },
  ];
}

// The baseline is the full document header set minus the Content Security
// Policy. It derives from the root `@policy.ts` document policy, the same
// declaration that governs route documents. CSP is excluded because the
// framework cannot hash a file it did not render. Trusted Types is excluded
// with it. A browser reads Trusted Types from the Content-Security-Policy
// header only.
async function loadBaselineFileSecurityPolicy(
  manifest: RouteManifest,
): Promise<SecurityPolicy> {
  const rootPolicyRoute = manifest.policies.find(
    (policy) => policy.fileSegments.length === 0,
  );
  const rootModule = await rootPolicyRoute?.load();

  return { headers: rootModule?.policy?.document?.headers };
}

function renderStaticFileHeaders(policy: SecurityPolicy) {
  return Object.fromEntries(createSecurityHeaders(policy, {}).entries());
}

function assertValidFileHeaderPattern(pattern: string) {
  try {
    new RegExp(pattern);
  } catch {
    throw new Error(
      `Static file header pattern is not a valid regular expression: ${JSON.stringify(pattern)}.`,
    );
  }
}

function normalizeOrigin(value: string | undefined) {
  let origin: URL;

  try {
    origin = new URL(value ?? "http://demiurge.local");
  } catch {
    throw new Error(
      `Static output origin must be an absolute HTTP(S) origin: ${JSON.stringify(value)}.`,
    );
  }

  if (
    (origin.protocol !== "http:" && origin.protocol !== "https:") ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error(
      `Static output origin must be an HTTP(S) origin without credentials, a path, query, or hash: ${JSON.stringify(value)}.`,
    );
  }

  return origin.origin;
}

function assertStaticPageApp(manifest: RouteManifest, pageCount: number) {
  if (pageCount === 0) {
    throw new Error("Static output requires at least one page route.");
  }

  const hasRootNotFound = manifest.fallbacks.notFound.some(
    (fallback) => fallback.fileSegments.length === 0,
  );

  if (!hasRootNotFound) {
    throw new Error(
      "Static output requires a root @not-found.tsx so 404.html is app-owned.",
    );
  }
}

async function validateStaticRoutes(manifest: RouteManifest) {
  const routeKinds = new Map<string, OutputKind>();

  for (const route of manifest.routes) {
    const routeModule = await route.load();
    const unsupportedMethods = staticUnsupportedMethods(routeModule);

    if (unsupportedMethods.length > 0) {
      throw new Error(
        `Static route ${JSON.stringify(route.file)} exports unsupported methods ${unsupportedMethods.join(", ")}. Deploy a runtime adapter for request-time methods.`,
      );
    }

    if (!routeModule.GET) {
      throw new Error(
        `Static route ${JSON.stringify(route.file)} does not export GET and cannot produce an output file.`,
      );
    }

    if (routeModule.GET.kind === "page") {
      routeKinds.set(route.file, "document");
      continue;
    }

    assertStaticResource(route.file, routeModule.GET);
    routeKinds.set(route.file, "resource");
  }

  return routeKinds;
}

function staticUnsupportedMethods(routeModule: RouteModule) {
  return (["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const)
    .filter((method) => routeModule[method] !== undefined);
}

function assertStaticResource(file: string, capability: RouteCapability) {
  if (
    (capability.kind === "text" ||
      capability.kind === "html" ||
      capability.kind === "json") &&
    typeof capability.value !== "function"
  ) {
    return;
  }

  const reason = "value" in capability && typeof capability.value === "function"
    ? `uses a request-dependent ${capability.kind} value`
    : `uses the ${capability.kind} response helper`;

  throw new Error(
    `Static route ${JSON.stringify(file)} ${reason} and cannot produce a fixed output file. Use a fixed text, html, or json value, or deploy a runtime adapter.`,
  );
}

function planOutputEntries(
  outputs: Array<{ kind: OutputKind; pathname: string }>,
) {
  const seenFiles = new Map<string, string>();
  const seenPathnames = new Set<string>();

  return outputs.map(({ kind, pathname }) => {
    if (seenPathnames.has(pathname)) {
      throw new Error(`Static output collected duplicate pathname ${JSON.stringify(pathname)}.`);
    }

    seenPathnames.add(pathname);

    const file = kind === "document"
      ? pathnameToDocumentFile(pathname)
      : pathnameToResourceFile(pathname);
    const portableFile = file.toLocaleLowerCase("en-US");
    const conflict = [...seenFiles.entries()].find(([seenFile]) =>
      seenFile === portableFile ||
      seenFile.startsWith(`${portableFile}/`) ||
      portableFile.startsWith(`${seenFile}/`)
    );

    if (conflict) {
      throw new Error(
        `Static paths ${JSON.stringify(conflict[1])} and ${JSON.stringify(pathname)} map to the same portable output file or to a file and directory conflict.`,
      );
    }

    seenFiles.set(portableFile, pathname);

    return { file, kind, pathname };
  });
}

function pathnameToDocumentFile(pathname: string) {
  if (!pathname.startsWith("/") || pathname.includes("?") || pathname.includes("#")) {
    throw new Error(`Static output received invalid pathname ${JSON.stringify(pathname)}.`);
  }

  if (pathname === "/") {
    return "index.html";
  }

  const segments = pathname.split("/").slice(1).map((segment) => {
    let decoded: string;

    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error(`Static output pathname is not valid UTF-8: ${JSON.stringify(pathname)}.`);
    }

    assertPortableSegment(decoded, pathname);
    return decoded;
  });

  return [...segments, "index.html"].join("/");
}

function pathnameToResourceFile(pathname: string) {
  if (pathname === "/") {
    throw new Error("A static resource route cannot own the root pathname.");
  }

  const documentFile = pathnameToDocumentFile(pathname);
  return documentFile.slice(0, -"/index.html".length);
}

function assertPortableSegment(segment: string, pathname: string) {
  const invalidWindowsName = /[<>:"|?*]/.test(segment) ||
    [...segment].some((character) => character.charCodeAt(0) <= 31) ||
    /[. ]$/.test(segment) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment);

  if (
    !segment ||
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\") ||
    invalidWindowsName
  ) {
    throw new Error(
      `Static pathname ${JSON.stringify(pathname)} contains a segment that is unsafe or not portable as a file name: ${JSON.stringify(segment)}.`,
    );
  }
}

function createStaticRequest(
  origin: string,
  pathname: string,
  kind: OutputKind,
) {
  return new Request(`${origin}${pathname}`, {
    headers: { accept: kind === "document" ? "text/html" : "*/*" },
  });
}

async function prepareDocumentOutput(
  entry: { file: string; pathname: string },
  response: Response,
  expectedStatus: 200 | 404,
): Promise<PendingOutput> {
  if (response.status !== expectedStatus) {
    throw new Error(
      `Static output for ${JSON.stringify(entry.pathname)} returned status ${response.status}; expected ${expectedStatus}.`,
    );
  }

  const contentType = response.headers.get("content-type");

  if (!contentType?.toLowerCase().startsWith("text/html")) {
    throw new Error(
      `Static output for ${JSON.stringify(entry.pathname)} returned ${JSON.stringify(contentType)} instead of text/html.`,
    );
  }

  if (response.headers.has("set-cookie")) {
    throw new Error(
      `Static output for ${JSON.stringify(entry.pathname)} attempted to set a cookie. Build artifacts cannot contain per-user response state.`,
    );
  }

  const html = await coverStructuredDataHashes(
    await response.text(),
    response.headers,
  );
  await validateStaticCsp(entry.pathname, html, response.headers);

  return {
    file: entry.file,
    headers: sortedHeaders(response.headers),
    body: html,
    pathname: entry.pathname,
    status: expectedStatus,
  };
}

async function prepareResourceOutput(
  entry: PlannedOutput,
  response: Response,
): Promise<PendingOutput> {
  if (response.status !== 200) {
    throw new Error(
      `Static output for ${JSON.stringify(entry.pathname)} returned status ${response.status}; expected 200.`,
    );
  }

  if (response.headers.has("set-cookie")) {
    throw new Error(
      `Static output for ${JSON.stringify(entry.pathname)} attempted to set a cookie. Build artifacts cannot contain per-user response state.`,
    );
  }

  return {
    file: entry.file,
    headers: sortedHeaders(response.headers),
    body: await response.text(),
    pathname: entry.pathname,
    status: 200,
  };
}

async function coverStructuredDataHashes(html: string, headers: Headers) {
  const markerPattern = new RegExp(
    `(?:^|\\s)${STRUCTURED_DATA_ATTRIBUTE}(?:\\s|$)`,
  );
  const elements = findRawTextElements(html, "script")
    .filter((element) => markerPattern.test(element.attributes));

  if (elements.length === 0) {
    return html;
  }

  const hashes = await Promise.all(
    elements.map((element) => cspHash(element.content)),
  );

  for (const headerName of [
    "content-security-policy",
    "content-security-policy-report-only",
  ]) {
    const csp = headers.get(headerName);
    if (csp) {
      headers.set(headerName, addScriptHashes(csp, hashes));
    }
  }

  return html.replace(
    new RegExp(`\\s${STRUCTURED_DATA_ATTRIBUTE}(?=\\s|>)`, "g"),
    "",
  );
}

function addScriptHashes(csp: string, hashes: readonly string[]) {
  const directives = csp.split(";")
    .map((directive) => directive.trim())
    .filter(Boolean);
  const scriptIndex = directives.findIndex((directive) =>
    directive.split(/\s+/, 1)[0]?.toLowerCase() === "script-src"
  );
  const defaultDirective = directives.find((directive) =>
    directive.split(/\s+/, 1)[0]?.toLowerCase() === "default-src"
  );
  const current = scriptIndex === -1 ? defaultDirective : directives[scriptIndex];

  if (!current) {
    return csp;
  }

  const sources = current.split(/\s+/).slice(1)
    .filter((source) => source !== "'none'");
  const scriptDirective = [
    "script-src",
    ...new Set([...sources, ...hashes]),
  ].join(" ");

  if (scriptIndex === -1) {
    directives.push(scriptDirective);
  } else {
    directives[scriptIndex] = scriptDirective;
  }

  return directives.join("; ");
}

async function validateStaticCsp(
  pathname: string,
  html: string,
  headers: Headers,
) {
  const csp = headers.get("content-security-policy");

  if (!csp) {
    return;
  }

  if (/'nonce-[^']+'/i.test(csp) || /\snonce\s*=/i.test(html)) {
    throw new Error(
      `Static output for ${JSON.stringify(pathname)} uses a nonce-backed CSP. Use security.static() with stable hashes or a runtime adapter that injects a fresh nonce.`,
    );
  }

  const directives = parseCsp(csp);

  await validateInlineElements(
    pathname,
    html,
    "script",
    effectiveSources(directives, "script-src", "default-src"),
  );
  await validateInlineElements(
    pathname,
    html,
    "style",
    effectiveSources(
      directives,
      "style-src-elem",
      "style-src",
      "default-src",
    ),
  );

  const styleAttributeSources = effectiveSources(
    directives,
    "style-src-attr",
    "style-src",
    "default-src",
  );

  if (
    styleAttributeSources &&
    /\sstyle\s*=/i.test(html) &&
    !styleAttributeSources.includes("'unsafe-inline'")
  ) {
    throw new Error(
      `Static output for ${JSON.stringify(pathname)} contains an inline style attribute that its CSP does not allow. Move the style into a stylesheet or explicitly allow inline styles.`,
    );
  }
}

function parseCsp(value: string) {
  const directives = new Map<string, string[]>();

  for (const rawDirective of value.split(";")) {
    const [name, ...sources] = rawDirective.trim().split(/\s+/);

    if (name) {
      directives.set(name.toLowerCase(), sources);
    }
  }

  return directives;
}

function effectiveSources(
  directives: Map<string, string[]>,
  ...names: string[]
) {
  for (const name of names) {
    const sources = directives.get(name);

    if (sources) {
      return sources;
    }
  }

  return undefined;
}

async function validateInlineElements(
  pathname: string,
  html: string,
  tagName: "script" | "style",
  sources: string[] | undefined,
) {
  if (!sources || sources.includes("'unsafe-inline'")) {
    return;
  }

  for (const element of findRawTextElements(html, tagName)) {
    if (tagName === "script") {
      const src = readHtmlAttribute(element.attributes, "src");

      if (src) {
        if (!allowsStaticScriptSource(sources, src)) {
          throw new Error(
            `Static output for ${JSON.stringify(pathname)} contains script ${JSON.stringify(src)} that the effective script-src directive does not allow. Add its origin to security.needs.script or the route CSP policy.`,
          );
        }

        continue;
      }
    }

    if (!element.content) {
      continue;
    }

    const hash = await cspHash(element.content);

    if (!sources.includes(hash)) {
      throw new Error(
        `Static output for ${JSON.stringify(pathname)} contains an inline ${tagName} without the required CSP hash ${hash}.`,
      );
    }
  }
}

function readHtmlAttribute(attributes: string, name: string) {
  const match = attributes.match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']+)["']`, "i"),
  );

  return match?.[1]?.replaceAll("&amp;", "&");
}

function allowsStaticScriptSource(
  sources: string[] | undefined,
  src: string,
) {
  if (!sources) {
    return true;
  }

  if (sources.includes("'none'")) {
    return false;
  }

  if (
    sources.includes("'strict-dynamic'") &&
    sources.some((source) =>
      source.startsWith("'nonce-") || /^'sha(?:256|384|512)-/.test(source)
    )
  ) {
    return false;
  }

  if (sources.includes("*")) {
    return true;
  }

  if (sources.includes("'self'") && src.startsWith("/") && !src.startsWith("//")) {
    return true;
  }

  if (src.startsWith("https:") && sources.includes("https:")) {
    return true;
  }

  if (src.startsWith("http:") && sources.includes("http:")) {
    return true;
  }

  let scriptUrl: URL;
  try {
    scriptUrl = new URL(src, "https://demiurge.invalid");
  } catch {
    return false;
  }

  return sources.some((source) => {
    if (source.startsWith("'")) {
      return false;
    }

    let sourceUrl: URL;
    try {
      sourceUrl = new URL(source);
    } catch {
      return false;
    }

    const hostnameMatches = sourceUrl.hostname.startsWith("*.")
      ? scriptUrl.hostname.endsWith(sourceUrl.hostname.slice(1)) &&
        scriptUrl.hostname !== sourceUrl.hostname.slice(2)
      : scriptUrl.hostname === sourceUrl.hostname;
    const pathMatches = sourceUrl.pathname === "/" ||
      sourceUrl.pathname.endsWith("/")
      ? scriptUrl.pathname.startsWith(sourceUrl.pathname)
      : scriptUrl.pathname === sourceUrl.pathname;

    return scriptUrl.protocol === sourceUrl.protocol &&
      hostnameMatches &&
      scriptUrl.port === sourceUrl.port &&
      pathMatches;
  });
}

function findRawTextElements(html: string, tagName: "script" | "style") {
  const lowerHtml = html.toLowerCase();
  const elements: Array<{ attributes: string; content: string }> = [];
  const opening = `<${tagName}`;
  const closing = `</${tagName}`;
  let cursor = 0;

  while (cursor < html.length) {
    const start = lowerHtml.indexOf(opening, cursor);

    if (start === -1) {
      break;
    }

    const openEnd = lowerHtml.indexOf(">", start + opening.length);
    const closeStart = openEnd === -1
      ? -1
      : lowerHtml.indexOf(closing, openEnd + 1);
    const closeEnd = closeStart === -1
      ? -1
      : lowerHtml.indexOf(">", closeStart + closing.length);

    if (openEnd === -1 || closeStart === -1 || closeEnd === -1) {
      throw new Error(`Static output contains an unclosed <${tagName}> element.`);
    }

    elements.push({
      attributes: html.slice(start + opening.length, openEnd),
      content: html.slice(openEnd + 1, closeStart),
    });
    cursor = closeEnd + 1;
  }

  return elements;
}

function sortedHeaders(headers: Headers) {
  return Object.fromEntries(
    [...headers.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function writeOutput(
  outDir: string,
  entries: PendingOutput[],
  assets: PendingAsset[],
  manifest: StaticOutputManifest,
) {
  const parent = dirname(outDir);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, ".demiurge-static-"));

  try {
    for (const output of [...entries, ...assets]) {
      const file = resolveContained(staging, output.file);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, output.body);
    }

    await writeFile(
      join(staging, STATIC_MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    const previousFiles = await readPreviousOutputFiles(outDir);
    await mkdir(outDir, { recursive: true });
    await cp(staging, outDir, { recursive: true, force: true });

    const currentFiles = new Set(
      [...entries, ...assets].map((output) => output.file),
    );

    for (const file of previousFiles) {
      if (!currentFiles.has(file)) {
        await rm(resolveContained(outDir, file), { force: true });
      }
    }
  } finally {
    await rm(staging, { force: true, recursive: true });
  }
}

async function readPreviousOutputFiles(outDir: string) {
  try {
    const source = await readFile(join(outDir, STATIC_MANIFEST_FILE), "utf8");
    const value = JSON.parse(source) as {
      adapter?: unknown;
      entries?: Array<{ file?: unknown }>;
      fontFiles?: unknown;
      imageFiles?: unknown;
      version?: unknown;
    };

    if (
      value.adapter !== "static" ||
      value.version !== 1 ||
      !Array.isArray(value.entries)
    ) {
      return [];
    }

    const fontFiles = Array.isArray(value.fontFiles) ? value.fontFiles : [];
    const imageFiles = Array.isArray(value.imageFiles) ? value.imageFiles : [];

    return [
      ...value.entries.map((entry) => entry.file),
      ...fontFiles,
      ...imageFiles,
    ].flatMap((file) =>
      typeof file === "string" && isSafeRelativeFile(file) ? [file] : []
    );
  } catch {
    return [];
  }
}

function resolveContained(root: string, file: string) {
  if (!isSafeRelativeFile(file)) {
    throw new Error(`Static output file must stay inside the output directory: ${JSON.stringify(file)}.`);
  }

  const resolvedRoot = resolve(root);
  const resolvedFile = resolve(resolvedRoot, file);

  if (relative(resolvedRoot, resolvedFile).split(sep).includes("..")) {
    throw new Error(`Static output file escaped the output directory: ${JSON.stringify(file)}.`);
  }

  return resolvedFile;
}

function isSafeRelativeFile(file: string) {
  return Boolean(file) &&
    !file.startsWith("/") &&
    !file.startsWith("\\") &&
    !file.split(/[\\/]/).includes("..");
}
