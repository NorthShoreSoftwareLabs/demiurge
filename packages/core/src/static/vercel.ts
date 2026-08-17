import {
  cp,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  getTransformedRoutes,
  normalizeRoutes,
  type Header,
  type Route,
} from "@vercel/routing-utils";
import { CONTENT_HASHED_FILE_NAME_PATTERN } from "../static-files";
import type {
  StaticOutputEntry,
  StaticOutputManifest,
} from "./index";

const CLIENT_MANIFEST_FILE = "demiurge-manifest.json";
const STATIC_MANIFEST_FILE = "demiurge-static-manifest.json";

export type VercelStaticCacheRule = {
  source: string;
  value: string;
};

export type VercelStaticOptions = {
  cache?: VercelStaticCacheRule[];
};

export type VercelStaticDeployment = {
  adapter: "vercel";
  cache: VercelStaticCacheRule[];
};

export type VercelOutputRoute = Route;

export type VercelOutputConfig = {
  overrides: Record<string, {
    contentType?: string;
    path?: string;
  }>;
  routes: VercelOutputRoute[];
  version: 3;
};

export function vercelStatic(
  options: VercelStaticOptions = {},
): VercelStaticDeployment {
  return {
    adapter: "vercel",
    cache: options.cache?.map((rule) => ({
      source: rule.source,
      value: rule.value,
    })) ?? [],
  };
}

export async function generateVercelStaticOutput(options: {
  deployment: VercelStaticDeployment;
  manifest: StaticOutputManifest;
  outDir: string;
  projectRoot: string;
}) {
  validateVercelDeployment(options.deployment);

  const projectRoot = resolve(options.projectRoot);
  const sourceRoot = resolve(options.outDir);
  const outputRoot = resolve(projectRoot, ".vercel/output");
  if (pathsOverlap(sourceRoot, outputRoot)) {
    throw new Error(
      "The static output directory must not overlap the Vercel output directory.",
    );
  }

  const outputParent = dirname(outputRoot);
  await mkdir(outputParent, { recursive: true });
  const stagingRoot = await mkdtemp(join(outputParent, "output-demiurge-"));

  try {
    const staticRoot = join(stagingRoot, "static");
    await cp(sourceRoot, staticRoot, {
      filter: (source) => {
        const file = relative(sourceRoot, source).split(sep).join("/");
        return file !== CLIENT_MANIFEST_FILE && file !== STATIC_MANIFEST_FILE;
      },
      recursive: true,
    });
    await writeFile(
      join(stagingRoot, "config.json"),
      `${JSON.stringify(createVercelOutputConfig(
        options.manifest,
        options.deployment,
      ), null, 2)}\n`,
    );

    await rm(outputRoot, { force: true, recursive: true });
    await rename(stagingRoot, outputRoot);
  } catch (error) {
    await rm(stagingRoot, { force: true, recursive: true });
    throw error;
  }

  return outputRoot;
}

export function createVercelOutputConfig(
  manifest: StaticOutputManifest,
  deployment: VercelStaticDeployment,
): VercelOutputConfig {
  const fallback = manifest.entries.find((entry) => entry.pathname === "*");
  if (!fallback) {
    throw new Error("Vercel output requires a static fallback entry.");
  }

  const applicationRoutes = transformApplicationCache(deployment.cache);
  const routes: Route[] = [];

  for (const entry of manifest.entries) {
    if (entry.pathname === "*") continue;
    const filePath = `/${entry.file}`;
    if (filePath !== entry.pathname) {
      routes.push({
        continue: true,
        dest: entry.pathname,
        src: exactPathPattern(filePath),
      });
    }
  }

  for (const entry of manifest.entries) {
    const headers = withoutContentType(entry.headers);
    if (Object.keys(headers).length === 0) continue;
    const pathname = entry.pathname === "*" ? `/${entry.file}` : entry.pathname;
    routes.push({
      continue: true,
      headers,
      src: exactPathPattern(pathname),
    });
  }

  routes.push(...applicationRoutes);

  for (const entry of manifest.entries) {
    if (entry.pathname === "*") {
      routes.push({
        dest: `/${entry.file}`,
        src: exactPathPattern(`/${entry.file}`),
        status: 404,
      });
      continue;
    }
    routes.push({
      dest: entry.pathname === "/" ? `/${entry.file}` : entry.pathname,
      src: exactPathPattern(entry.pathname),
    });
  }

  routes.push({ handle: "hit" });
  for (const rule of [...manifest.fileHeaderRules].reverse()) {
    routes.push({
      continue: true,
      headers: { ...rule.headers },
      src: translateFileHeaderPattern(rule.pattern),
    });
  }

  routes.push({ handle: "error" });
  const fallbackHeaders = withoutContentType(fallback.headers);
  if (Object.keys(fallbackHeaders).length > 0) {
    routes.push({
      continue: true,
      headers: fallbackHeaders,
      src: "^/.*$",
    });
  }
  routes.push(...applicationRoutes.map((route) => ({ ...route })));
  routes.push({ dest: `/${fallback.file}`, src: "^/.*$", status: 404 });

  const normalized = normalizeRoutes(routes);
  if (normalized.error || !normalized.routes) {
    throw new Error(
      `Vercel rejected the generated routes: ${normalized.error?.message ?? "The route list is empty."}`,
    );
  }

  return {
    overrides: Object.fromEntries(
      manifest.entries.map((entry) => [entry.file, createOverride(entry)]),
    ),
    routes: normalized.routes,
    version: 3,
  };
}

function createOverride(entry: StaticOutputEntry) {
  const override: { contentType?: string; path?: string } = {};
  const contentType = entry.headers["content-type"];
  if (contentType) override.contentType = contentType;

  if (entry.pathname !== "*") {
    const naturalPath = entry.file === "index.html"
      ? "/"
      : `/${entry.file}`;
    if (entry.pathname !== naturalPath) {
      override.path = entry.pathname.slice(1);
    }
  }

  return override;
}

function exactPathPattern(pathname: string) {
  const escaped = pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return pathname === "/" ? "^/$" : `^${escaped}/?$`;
}

function withoutContentType(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== "content-type"),
  );
}

function translateFileHeaderPattern(pattern: string) {
  if (pattern === ".*") {
    return "^/.*$";
  }
  if (pattern === CONTENT_HASHED_FILE_NAME_PATTERN.source) {
    return "^/(?:.*/)?[^/]*-[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9]+$";
  }

  return `^/${translateFileNamePattern(pattern)}$`;
}

// Demiurge tests a static file header pattern against the file basename with
// an unanchored `RegExp.test(...)`. The pattern can match anywhere in the
// name. Vercel matches `src` against the complete pathname, which always
// carries a directory prefix. This rebuilds the basename test as a pathname
// pattern. A leading `^` pins the match to the start of the basename. A
// trailing `$` pins it to the end. Without an anchor, the match can begin or
// end anywhere in the basename.
function translateFileNamePattern(pattern: string) {
  const startsAtBasename = pattern.startsWith("^");
  const endsAtBasename = pattern.endsWith("$") && !pattern.endsWith("\\$");
  const body = pattern.slice(
    startsAtBasename ? 1 : 0,
    endsAtBasename ? -1 : undefined,
  );
  const prefix = startsAtBasename ? "(?:.*/)?" : "(?:.*/)?[^/]*";
  const suffix = endsAtBasename ? "" : "[^/]*";

  return `${prefix}(?:${body})${suffix}`;
}

function transformApplicationCache(cache: VercelStaticCacheRule[]) {
  const headers: Header[] = cache.map((rule) => ({
    headers: [{ key: "cache-control", value: rule.value }],
    source: rule.source,
  }));
  const transformed = getTransformedRoutes({ headers });
  if (transformed.error || !transformed.routes) {
    throw new Error(
      `A Vercel static header rule is not valid: ${transformed.error?.message ?? "The route list is empty."}`,
    );
  }
  return transformed.routes;
}

function validateVercelDeployment(deployment: VercelStaticDeployment) {
  if (deployment.adapter !== "vercel" || !Array.isArray(deployment.cache)) {
    throw new Error("The Vercel static adapter configuration is not valid.");
  }

  for (const rule of deployment.cache) {
    if (
      !rule ||
      typeof rule !== "object" ||
      typeof rule.source !== "string" ||
      !rule.source ||
      typeof rule.value !== "string" ||
      !rule.value
    ) {
      throw new Error("A Vercel static header rule is not valid.");
    }
  }
}

function pathsOverlap(left: string, right: string) {
  const fromLeft = relative(left, right);
  const fromRight = relative(right, left);
  return isSameOrChildPath(fromLeft) || isSameOrChildPath(fromRight);
}

function isSameOrChildPath(pathname: string) {
  return !pathname ||
    (pathname !== ".." && !pathname.startsWith(`..${sep}`) &&
      !pathname.startsWith("/"));
}
