import type { ComponentType } from "react";
import { createMemoryCache, type Cache } from "../data";
import {
  resolveLinks,
  resolveMetadata,
  resolveScripts,
  type InitialRouteData,
  type LinkTag,
  type ResolvedMetadata,
  type ScriptTag,
} from "../document";
import type {
  LayoutProps,
  NotFoundProps,
  PageRenderOptions,
  PathVars,
  RouteErrorProps,
  RouteContext,
  RouteImporter,
  RouteModule,
  RouteProps,
} from "../route";

export type RouteRecord = {
  file: string;
  fileSegments: string[];
  segments: string[];
  score: number;
  load: RouteImporter;
};

export type LayoutRoute = {
  file: string;
  fileSegments: string[];
  segments: string[];
  load: RouteImporter;
};

export type PolicyRoute = {
  file: string;
  fileSegments: string[];
  segments: string[];
  load: RouteImporter;
};

export type MiddlewareRoute = {
  file: string;
  fileSegments: string[];
  segments: string[];
  load: RouteImporter;
};

export type FallbackRoute = {
  file: string;
  fileSegments: string[];
  segments: string[];
  load: RouteImporter;
};

export type RouteManifest = {
  fallbacks: {
    error: FallbackRoute[];
    loading: FallbackRoute[];
    notFound: FallbackRoute[];
  };
  routes: RouteRecord[];
  layouts: LayoutRoute[];
  middlewares: MiddlewareRoute[];
  policies: PolicyRoute[];
};

export type LoadedRouteMatch = {
  data?: unknown;
  error?: ComponentType<RouteErrorProps>;
  links: LinkTag[];
  page: ComponentType<RouteProps<string, unknown>>;
  layouts: ComponentType<LayoutProps>[];
  locale?: string;
  metadata: ResolvedMetadata;
  path: PathVars;
  pathname: string;
  render: PageRenderOptions;
  scripts: ScriptTag[];
};

export type StaticRoutePath = {
  file: string;
  locale?: string;
  path: PathVars;
  pattern: string;
  pathname: string;
};

export type LoadedNotFoundMatch = {
  layouts: ComponentType<LayoutProps>[];
  locale?: string;
  metadata: ResolvedMetadata;
  notFound?: ComponentType<NotFoundProps>;
  pathname: string;
};

export type PendingRouteMatch =
  | {
      error: unknown;
      Error?: ComponentType<RouteErrorProps>;
      locale?: string;
      pathname: string;
      status: "error";
    }
  | { loading?: ComponentType; status: "loading" }
  | (LoadedNotFoundMatch & { status: "not-found" })
  | { status: "ready"; match: LoadedRouteMatch };

export function createRouteManifest(routes: Record<string, RouteImporter>) {
  const manifest: RouteManifest = {
    fallbacks: {
      error: [],
      loading: [],
      notFound: [],
    },
    routes: [],
    layouts: [],
    middlewares: [],
    policies: [],
  };

  for (const [file, load] of Object.entries(routes)) {
    const routePath = file
      .replace(/^\/src\/routes\//, "")
      .replace(/^\.\/routes\//, "")
      .replace(/\.tsx?$/, "")
      .split("/");

    const basename = routePath.at(-1);

    if (basename === "@layout") {
      manifest.layouts.push({
        file,
        fileSegments: routePath.slice(0, -1),
        segments: toRouteSegments(routePath.slice(0, -1)),
        load,
      });
      continue;
    }

    if (basename === "@policy") {
      manifest.policies.push({
        file,
        fileSegments: routePath.slice(0, -1),
        segments: toRouteSegments(routePath.slice(0, -1)),
        load,
      });
      continue;
    }

    if (basename === "@middleware") {
      manifest.middlewares.push({
        file,
        fileSegments: routePath.slice(0, -1),
        segments: toRouteSegments(routePath.slice(0, -1)),
        load,
      });
      continue;
    }

    if (basename === "@loading") {
      manifest.fallbacks.loading.push({
        file,
        fileSegments: routePath.slice(0, -1),
        segments: toRouteSegments(routePath.slice(0, -1)),
        load,
      });
      continue;
    }

    if (basename === "@error") {
      manifest.fallbacks.error.push({
        file,
        fileSegments: routePath.slice(0, -1),
        segments: toRouteSegments(routePath.slice(0, -1)),
        load,
      });
      continue;
    }

    if (basename === "@not-found") {
      manifest.fallbacks.notFound.push({
        file,
        fileSegments: routePath.slice(0, -1),
        segments: toRouteSegments(routePath.slice(0, -1)),
        load,
      });
      continue;
    }

    manifest.routes.push({
      file,
      fileSegments: routePath,
      segments: toRouteSegments(routePath),
      score: scoreRoute(routePath),
      load,
    });
  }

  validateRoutePatterns(manifest.routes);
  manifest.routes.sort(compareRouteSpecificity);
  manifest.layouts.sort(
    (a, b) => a.fileSegments.length - b.fileSegments.length || a.file.localeCompare(b.file),
  );
  manifest.policies.sort(
    (a, b) => a.fileSegments.length - b.fileSegments.length || a.file.localeCompare(b.file),
  );
  manifest.middlewares.sort(
    (a, b) => a.fileSegments.length - b.fileSegments.length || a.file.localeCompare(b.file),
  );
  manifest.fallbacks.loading.sort(
    (a, b) => a.fileSegments.length - b.fileSegments.length || a.file.localeCompare(b.file),
  );
  manifest.fallbacks.error.sort(
    (a, b) => a.fileSegments.length - b.fileSegments.length || a.file.localeCompare(b.file),
  );
  manifest.fallbacks.notFound.sort(
    (a, b) => a.fileSegments.length - b.fileSegments.length || a.file.localeCompare(b.file),
  );

  return manifest;
}

function validateRoutePatterns(routes: RouteRecord[]) {
  const shapes = new Map<string, RouteRecord>();

  for (const route of routes) {
    const catchallIndex = route.segments.findIndex((segment) =>
      segment.startsWith("*"),
    );

    if (catchallIndex !== -1 && catchallIndex !== route.segments.length - 1) {
      throw new Error(
        `Catchall route segment in "${route.file}" must be the final URL segment.`,
      );
    }

    const shape = route.segments.map(canonicalRouteSegment).join("/");
    const existing = shapes.get(shape);

    if (existing) {
      throw new Error(
        `Ambiguous routes "${existing.file}" and "${route.file}" have the same runtime shape and both match "${routeWitnessPath(route.segments)}".`,
      );
    }

    shapes.set(shape, route);
  }
}

function canonicalRouteSegment(segment: string) {
  if (segment.startsWith("*")) {
    return "*";
  }

  if (segment.startsWith(":")) {
    return ":";
  }

  return `=${segment}`;
}

function routeWitnessPath(segments: string[]) {
  if (segments.length === 0) {
    return "/";
  }

  return `/${segments
    .map((segment) => segment.startsWith(":") || segment.startsWith("*")
      ? "example"
      : segment)
    .join("/")}`;
}

function compareRouteSpecificity(left: RouteRecord, right: RouteRecord) {
  const length = Math.max(left.segments.length, right.segments.length);

  for (let index = 0; index < length; index += 1) {
    const difference =
      routeSegmentSpecificity(right.segments[index]) -
      routeSegmentSpecificity(left.segments[index]);

    if (difference !== 0) {
      return difference;
    }
  }

  return left.file.localeCompare(right.file);
}

function routeSegmentSpecificity(segment: string | undefined) {
  if (segment === undefined) {
    return 4;
  }

  if (segment.startsWith("*")) {
    return 1;
  }

  if (segment.startsWith(":")) {
    return 2;
  }

  return 3;
}

export async function loadPageRoute(
  manifest: RouteManifest,
  pathname: string,
  request = new Request(`http://demiurge.local${pathname}`),
  initialData?: InitialRouteData,
  cache: Cache = createMemoryCache(),
  options: {
    documentContributions?: boolean;
    locale?: string;
    requestContext?: Record<string, unknown>;
  } = {},
): Promise<PendingRouteMatch> {
  const documentContributions = options.documentContributions ?? true;
  const routeMatch = findRouteMatch(manifest.routes, pathname);

  if (!routeMatch) {
    return {
      ...(await loadNotFoundMatch(manifest, pathname, {
        documentContributions,
        locale: options.locale,
      })),
      status: "not-found",
    };
  }

  const matchingLayouts = manifest.layouts.filter((layout) =>
    isAttachedFileForRoute(layout.fileSegments, routeMatch.route.fileSegments),
  );

  const pageModule = await routeMatch.route.load();

  if (!pageModule.GET || pageModule.GET.kind !== "page") {
    return {
      ...(await loadNotFoundMatch(manifest, pathname, {
        fallback: findClosestAttachedFile(
          manifest.fallbacks.notFound,
          routeMatch.route,
        ),
        documentContributions,
        layouts: matchingLayouts,
        locale: options.locale,
      })),
      status: "not-found",
    };
  }

  const layoutModules =
    pageModule.GET.layout === false
      ? []
      : await Promise.all(matchingLayouts.map((layout) => layout.load()));
  const url = new URL(request.url);
  const context = {
    cache,
    context: options.requestContext ?? {},
    locale: options.locale,
    path: routeMatch.path,
    pathname,
    request,
    search: url.searchParams,
    url,
  };

  // TYPE-EVIDENCE: the route module view and layout exports are React components. The casts label them as component types.
  return {
    status: "ready",
    match: {
      data:
        pageModule.GET.data && !initialData?.hasData
          ? await pageModule.GET.data(context)
          : initialData?.data,
      error: await loadErrorFallbackForRoute(manifest, routeMatch.route),
      links: documentContributions
        ? await resolveLinks(
          [
            ...layoutModules.map((module) => module.links),
            pageModule.links,
          ],
          context,
        )
        : [],
      page: pageModule.GET.view as ComponentType<RouteProps<string, unknown>>,
      layouts: layoutModules.map(
        (module) => module.default as ComponentType<LayoutProps>,
      ),
      locale: options.locale,
      metadata: documentContributions
        ? resolveMetadata(...await Promise.all([
          ...layoutModules.map((module) => resolveRouteMetadata(module, context)),
          resolveRouteMetadata(pageModule, context),
        ]))
        : resolveMetadata(),
      path: routeMatch.path,
      pathname,
      render: pageModule.GET.render,
      scripts: documentContributions
        ? await resolveScripts(
          [
            ...layoutModules.map((module) => module.scripts),
            pageModule.scripts,
          ],
          context,
        )
        : [],
    },
  };
}

export async function collectStaticRoutePaths(
  manifest: RouteManifest,
  options: {
    includePages?: boolean;
    includeResources?: boolean;
    locale?: string;
  } = {},
): Promise<StaticRoutePath[]> {
  const cache = createMemoryCache();
  const paths: StaticRoutePath[] = [];

  for (const route of manifest.routes) {
    const routeModule = await route.load();

    if (!routeModule.GET) {
      continue;
    }

    if (routeModule.GET.kind !== "page" && !options.includeResources) {
      continue;
    }

    if (routeModule.GET.kind === "page" && options.includePages === false) {
      continue;
    }

    if (
      routeModule.GET.kind === "page" &&
      routeModule.GET.render.mode !== "static"
    ) {
      throw new Error(
        `Page route "${route.file}" uses render mode "${routeModule.GET.render.mode}" and cannot be emitted as static output. Set render: { mode: "static" } or deploy a runtime adapter.`,
      );
    }

    const pattern = toRoutePattern(route.segments);
    const dynamicNames = getDynamicSegmentNames(route.segments);

    if (dynamicNames.length === 0) {
      paths.push({
        file: route.file,
        path: {},
        pattern,
        pathname: pattern,
      });
      continue;
    }

    if (!routeModule.paths) {
      throw new Error(
        `Dynamic static route "${route.file}" must export paths for "${pattern}".`,
      );
    }

    const routePaths = await routeModule.paths({
      cache,
      locale: options.locale,
    });

    for (const path of routePaths) {
      const normalizedPath = normalizeStaticPath(route, pattern, path);

      paths.push({
        file: route.file,
        path: normalizedPath,
        pattern,
        pathname: fillStaticPathname(route.segments, normalizedPath),
      });
    }
  }

  return paths;
}

export async function loadLoadingFallback(
  manifest: RouteManifest,
  pathname: string,
) {
  const routeMatch = findRouteMatch(manifest.routes, pathname);

  if (!routeMatch) {
    return undefined;
  }

  return await loadFallbackComponent(
    findClosestAttachedFile(manifest.fallbacks.loading, routeMatch.route),
  );
}

export async function loadErrorFallback(
  manifest: RouteManifest,
  pathname: string,
) {
  let routeMatch: ReturnType<typeof findRouteMatch>;

  try {
    routeMatch = findRouteMatch(manifest.routes, pathname);
  } catch (error) {
    if (!(error instanceof MalformedPathnameError)) throw error;

    return await loadErrorFallbackComponent(
      manifest.fallbacks.error.find((fallback) =>
        fallback.fileSegments.length === 0
      ),
    );
  }

  if (routeMatch) {
    return await loadErrorFallbackForRoute(manifest, routeMatch.route);
  }

  return await loadErrorFallbackForPath(manifest, pathname);
}

async function loadErrorFallbackForRoute(
  manifest: RouteManifest,
  route: RouteRecord,
) {
  return await loadErrorFallbackComponent(
    findClosestAttachedFile(manifest.fallbacks.error, route),
  );
}

async function loadErrorFallbackForPath(
  manifest: RouteManifest,
  pathname: string,
) {
  return await loadErrorFallbackComponent(
    findClosestFallbackForPath(manifest.fallbacks.error, pathname),
  );
}

// A not-found render has no matched route. Therefore, layouts resolve from the
// requested pathname. Layout loading tolerates errors. A layout above
// `/admin/nope` can require a session and throw. This error must select the
// layout-free document, not a 500 response. This path prevents a blank page.
export async function loadNotFoundMatch(
  manifest: RouteManifest,
  pathname: string,
  options: {
    documentContributions?: boolean;
    fallback?: FallbackRoute;
    layouts?: LayoutRoute[];
    onLayoutError?: (error: unknown) => void;
    locale?: string;
  } = {},
): Promise<LoadedNotFoundMatch> {
  const fallback =
    options.fallback ??
    findClosestFallbackForPath(manifest.fallbacks.notFound, pathname);
  const fallbackModule = await fallback?.load();
  // TYPE-EVIDENCE: the fallback module default export is a React component. The cast labels it as a not found component type.
  const notFound = fallbackModule?.default as
    | ComponentType<NotFoundProps>
    | undefined;
  const documentContributions = options.documentContributions ?? true;
  const metadataContext = { locale: options.locale, path: {}, pathname };

  if (fallbackModule?.layout === false) {
    return {
      layouts: [],
      locale: options.locale,
      metadata: documentContributions
        ? resolveMetadata(await resolveRouteMetadata(fallbackModule, metadataContext))
        : resolveMetadata(),
      notFound,
      pathname,
    };
  }

  const layoutRoutes = options.layouts ?? findLayoutsForPath(manifest, pathname);

  try {
    const layoutModules = await Promise.all(
      layoutRoutes.map((layout) => layout.load()),
    );

    // TYPE-EVIDENCE: the layout module default export is a React component. The cast labels it as a layout component type.
    return {
      layouts: layoutModules.map(
        (module) => module.default as ComponentType<LayoutProps>,
      ),
      locale: options.locale,
      metadata: documentContributions
        ? resolveMetadata(...await Promise.all([
          ...layoutModules.map((module) => resolveRouteMetadata(module, metadataContext)),
          resolveRouteMetadata(fallbackModule, metadataContext),
        ]))
        : resolveMetadata(),
      notFound,
      pathname,
    };
  } catch (error) {
    options.onLayoutError?.(error);

    return {
      layouts: [],
      locale: options.locale,
      metadata: documentContributions
        ? resolveMetadata(await resolveRouteMetadata(fallbackModule, metadataContext))
        : resolveMetadata(),
      notFound,
      pathname,
    };
  }
}

async function resolveRouteMetadata(
  module: RouteModule | undefined,
  context: RouteContext,
) {
  return typeof module?.metadata === "function"
    ? await module.metadata(context)
    : module?.metadata;
}

export function findLayoutsForPath(
  manifest: RouteManifest,
  pathname: string,
) {
  const pathnameSegments = splitPathname(pathname);

  // A route group contributes no URL segment, so a layout inside one cannot be
  // resolved from a pathname alone. Skipping them keeps an unmatched path from
  // picking up a layout it would never have inherited.
  return manifest.layouts.filter(
    (layout) =>
      !layout.fileSegments.some(isRouteGroupSegment) &&
      isFallbackForPath(layout.segments, pathnameSegments),
  );
}

export function findPoliciesForPath(
  manifest: RouteManifest,
  pathname: string,
) {
  const pathnameSegments = splitPathname(pathname);

  return manifest.policies.filter(
    (policy) =>
      !policy.fileSegments.some(isRouteGroupSegment) &&
      isFallbackForPath(policy.segments, pathnameSegments),
  );
}

function findClosestAttachedFile(
  fallbacks: FallbackRoute[],
  route: RouteRecord,
) {
  for (let index = fallbacks.length - 1; index >= 0; index -= 1) {
    const fallback = fallbacks[index];

    if (isAttachedFileForRoute(fallback.fileSegments, route.fileSegments)) {
      return fallback;
    }
  }

  return undefined;
}

function findClosestFallbackForPath(
  fallbacks: FallbackRoute[],
  pathname: string,
) {
  const pathnameSegments = splitPathname(pathname);

  for (let index = fallbacks.length - 1; index >= 0; index -= 1) {
    const fallback = fallbacks[index];

    if (
      !fallback.fileSegments.some(isRouteGroupSegment) &&
      isFallbackForPath(fallback.segments, pathnameSegments)
    ) {
      return fallback;
    }
  }

  return undefined;
}

function isFallbackForPath(
  fallbackSegments: string[],
  pathnameSegments: string[],
) {
  return fallbackSegments.every((segment, index) => {
    if (segment.startsWith("*")) {
      return pathnameSegments.length > index;
    }

    if (segment.startsWith(":")) {
      return Boolean(pathnameSegments[index]);
    }

    return pathnameSegments[index] === segment;
  });
}

async function loadFallbackComponent(fallback: FallbackRoute | undefined) {
  if (!fallback) {
    return undefined;
  }

  const module = await fallback.load();

  // TYPE-EVIDENCE: the fallback module default export is a React component. The cast labels it as a component type.
  return module.default as ComponentType | undefined;
}

async function loadErrorFallbackComponent(fallback: FallbackRoute | undefined) {
  if (!fallback) {
    return undefined;
  }

  const module = await fallback.load();

  // TYPE-EVIDENCE: the fallback module default export is a React component. The cast labels it as a route error component type.
  return module.default as ComponentType<RouteErrorProps> | undefined;
}

export function findRouteMatch(routes: RouteRecord[], pathname: string) {
  const pathnameSegments = splitPathname(pathname);

  for (const route of routes) {
    const path = matchSegments(route.segments, pathnameSegments);

    if (path) {
      return { route, path };
    }
  }

  return null;
}

export const loadRoute = loadPageRoute;
export const findPageMatch = findRouteMatch;

export function matchSegments(
  routeSegments: string[],
  pathnameSegments: string[],
) {
  const path: PathVars = {};

  for (let index = 0; index < routeSegments.length; index += 1) {
    const routeSegment = routeSegments[index];
    const pathnameSegment = pathnameSegments[index];

    if (routeSegment?.startsWith("*")) {
      path[routeSegment.slice(1)] = pathnameSegments.slice(index).join("/");
      return path;
    }

    if (!pathnameSegment) {
      return null;
    }

    if (routeSegment.startsWith(":")) {
      path[routeSegment.slice(1)] = pathnameSegment;
      continue;
    }

    if (routeSegment !== pathnameSegment) {
      return null;
    }
  }

  return routeSegments.length === pathnameSegments.length ? path : null;
}

export function isLayoutForPage(layoutSegments: string[], pageSegments: string[]) {
  return layoutSegments.every(
    (segment, index) => pageSegments[index] === segment,
  );
}

export function isAttachedFileForRoute(
  attachedFileSegments: string[],
  routeFileSegments: string[],
) {
  return attachedFileSegments.every(
    (segment, index) => routeFileSegments[index] === segment,
  );
}

export function toRouteSegments(fileSegments: string[]) {
  return fileSegments.flatMap((segment) => {
    if (isRouteGroupSegment(segment)) {
      return [];
    }

    if (segment === "index") {
      return [];
    }

    if (segment.startsWith("[...") && segment.endsWith("]")) {
      return [`*${segment.slice(4, -1)}`];
    }

    if (segment.startsWith("[") && segment.endsWith("]")) {
      return [`:${segment.slice(1, -1)}`];
    }

    return [segment];
  });
}

export function isRouteGroupSegment(segment: string) {
  return segment.startsWith("(") && segment.endsWith(")");
}

export function toRoutePattern(routeSegments: string[]) {
  if (routeSegments.length === 0) {
    return "/";
  }

  return `/${routeSegments.map(toRoutePatternSegment).join("/")}`;
}

function toRoutePatternSegment(segment: string) {
  if (segment.startsWith("*")) {
    return `[...${segment.slice(1)}]`;
  }

  if (segment.startsWith(":")) {
    return `[${segment.slice(1)}]`;
  }

  return segment;
}

function getDynamicSegmentNames(routeSegments: string[]) {
  return routeSegments.flatMap((segment) => {
    if (segment.startsWith(":") || segment.startsWith("*")) {
      return [segment.slice(1)];
    }

    return [];
  });
}

function normalizeStaticPath(
  route: RouteRecord,
  pattern: string,
  path: Record<string, unknown>,
) {
  const normalizedPath: PathVars = {};

  for (const segment of route.segments) {
    if (!segment.startsWith(":") && !segment.startsWith("*")) {
      continue;
    }

    const name = segment.slice(1);
    const value = path[name];

    if (value === undefined) {
      throw new Error(
        `Static paths for "${route.file}" must include "${name}" for "${pattern}".`,
      );
    }

    if (!isStaticPathValue(value)) {
      throw new Error(
        `Static path "${name}" for "${route.file}" must be a string, number, or boolean.`,
      );
    }

    normalizedPath[name] = String(value);
  }

  return normalizedPath;
}

function isStaticPathValue(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function fillStaticPathname(routeSegments: string[], path: PathVars) {
  const pathname = routeSegments.map((segment) => {
    if (segment.startsWith("*")) {
      return path[segment.slice(1)]
        .split("/")
        .filter(Boolean)
        .map(encodeURIComponent)
        .join("/");
    }

    if (segment.startsWith(":")) {
      return encodeURIComponent(path[segment.slice(1)]);
    }

    return encodeURIComponent(segment);
  }).filter(Boolean).join("/");

  return `/${pathname}`;
}

export function scoreRoute(fileSegments: string[]) {
  return toRouteSegments(fileSegments).reduce((score, segment) => {
    if (segment.startsWith("*")) {
      return score;
    }

    if (segment.startsWith(":")) {
      return score + 1;
    }

    return score + 2;
  }, 0);
}

export function splitPathname(pathname: string) {
  return pathname
    .replace(/^\/|\/$/g, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        // Split before decoding so `%2F` remains content in one segment
        // instead of silently changing the route shape.
        return decodeURIComponent(segment);
      } catch (cause) {
        throw new MalformedPathnameError(pathname, { cause });
      }
    });
}

export class MalformedPathnameError extends URIError {
  readonly pathname: string;

  constructor(pathname: string, options?: ErrorOptions) {
    super(
      `Malformed percent encoding in URL pathname ${JSON.stringify(pathname)}.`,
      options,
    );
    this.name = "MalformedPathnameError";
    this.pathname = pathname;
  }
}
