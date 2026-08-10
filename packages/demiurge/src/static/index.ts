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
import {
  collectStaticRoutePaths,
  createRouteManifest,
  type RouteManifest,
} from "../router";
import type { RouteImporter } from "../route";
import {
  handleRequestWithManifest,
  renderNotFoundResponse,
  type RequestErrorReporter,
  type SsrOptions,
} from "../server";
import { createMemoryRateLimitStore, cspHash } from "../security";

const STATIC_MANIFEST_FILE = "demiurge-static-manifest.json";

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
  version: 1;
};

export type GenerateStaticOutputOptions = {
  onError?: RequestErrorReporter;
  origin?: string;
  outDir: string;
  routes: Record<string, RouteImporter>;
  ssr?: SsrOptions;
};

type PendingOutput = StaticOutputEntry & {
  html: string;
};

export async function generateStaticOutput(
  options: GenerateStaticOutputOptions,
): Promise<StaticOutputManifest> {
  const origin = normalizeOrigin(options.origin);
  const outDir = resolve(options.outDir);
  const manifest = createRouteManifest(options.routes);
  const paths = await collectStaticRoutePaths(manifest);

  assertStaticPageApp(manifest, paths.length);

  const outputEntries = planOutputEntries(paths.map((path) => path.pathname));
  const rateLimitStore = createMemoryRateLimitStore();
  const pending: PendingOutput[] = [];

  for (const entry of outputEntries) {
    const request = createDocumentRequest(origin, entry.pathname);
    const response = await handleRequestWithManifest(manifest, request, {
      onError: options.onError,
      rateLimitStore,
      ssr: options.ssr,
    });

    pending.push(await prepareOutput(entry, response, 200));
  }

  const notFoundResponse = await renderNotFoundResponse(
    manifest,
    createDocumentRequest(origin, "/404"),
    {
      ...options.ssr,
      onError: (error, site) =>
        options.onError?.(error, { pathname: "/404", site }),
    },
  );
  pending.push(
    await prepareOutput(
      {
        file: "404.html",
        pathname: "*",
      },
      notFoundResponse,
      404,
    ),
  );

  pending.sort((left, right) => left.file.localeCompare(right.file));

  const outputManifest: StaticOutputManifest = {
    adapter: "static",
    entries: pending.map(({ html: _html, ...entry }) => entry),
    version: 1,
  };

  await writeOutput(outDir, pending, outputManifest);

  return outputManifest;
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

function planOutputEntries(pathnames: string[]) {
  const seenFiles = new Map<string, string>();
  const seenPathnames = new Set<string>();

  return pathnames.map((pathname) => {
    if (seenPathnames.has(pathname)) {
      throw new Error(`Static output collected duplicate pathname ${JSON.stringify(pathname)}.`);
    }

    seenPathnames.add(pathname);

    const file = pathnameToFile(pathname);
    const portableFile = file.toLocaleLowerCase("en-US");
    const conflictingPathname = seenFiles.get(portableFile);

    if (conflictingPathname) {
      throw new Error(
        `Static paths ${JSON.stringify(conflictingPathname)} and ${JSON.stringify(pathname)} map to the same portable output file ${JSON.stringify(file)}.`,
      );
    }

    seenFiles.set(portableFile, pathname);

    return { file, pathname };
  });
}

function pathnameToFile(pathname: string) {
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

function createDocumentRequest(origin: string, pathname: string) {
  return new Request(`${origin}${pathname}`, {
    headers: { accept: "text/html" },
  });
}

async function prepareOutput(
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

  const html = await response.text();
  await validateStaticCsp(entry.pathname, html, response.headers);

  return {
    ...entry,
    headers: sortedHeaders(response.headers),
    html,
    status: expectedStatus,
  };
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
    effectiveSources(directives, "script-src"),
  );
  await validateInlineElements(
    pathname,
    html,
    "style",
    effectiveSources(directives, "style-src"),
  );

  const styleSources = effectiveSources(directives, "style-src");

  if (/\sstyle\s*=/i.test(html) && !styleSources.includes("'unsafe-inline'")) {
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

function effectiveSources(directives: Map<string, string[]>, name: string) {
  return directives.get(name) ?? directives.get("default-src") ?? [];
}

async function validateInlineElements(
  pathname: string,
  html: string,
  tagName: "script" | "style",
  sources: string[],
) {
  if (sources.includes("'unsafe-inline'")) {
    return;
  }

  for (const element of findRawTextElements(html, tagName)) {
    if (tagName === "script" && /(?:^|\s)src\s*=/i.test(element.attributes)) {
      continue;
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
  manifest: StaticOutputManifest,
) {
  const parent = dirname(outDir);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, ".demiurge-static-"));

  try {
    for (const entry of entries) {
      const file = resolveContained(staging, entry.file);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, entry.html);
    }

    await writeFile(
      join(staging, STATIC_MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    const previousFiles = await readPreviousOutputFiles(outDir);
    await mkdir(outDir, { recursive: true });
    await cp(staging, outDir, { recursive: true, force: true });

    const currentFiles = new Set(entries.map((entry) => entry.file));

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
      version?: unknown;
    };

    if (
      value.adapter !== "static" ||
      value.version !== 1 ||
      !Array.isArray(value.entries)
    ) {
      return [];
    }

    return value.entries.flatMap((entry) =>
      typeof entry.file === "string" &&
        entry.file.endsWith(".html") &&
        isSafeRelativeFile(entry.file)
        ? [entry.file]
        : []
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
