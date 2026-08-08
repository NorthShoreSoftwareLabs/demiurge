import type { ComponentType } from "react";
import type {
  LayoutProps,
  NotFoundProps,
  PathVars,
  RouteErrorProps,
  RouteImporter,
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
  error?: ComponentType<RouteErrorProps>;
  page: ComponentType<RouteProps>;
  layouts: ComponentType<LayoutProps>[];
  path: PathVars;
  pathname: string;
};

export type PendingRouteMatch =
  | {
      error: unknown;
      Error?: ComponentType<RouteErrorProps>;
      pathname: string;
      status: "error";
    }
  | { loading?: ComponentType; status: "loading" }
  | {
      notFound?: ComponentType<NotFoundProps>;
      pathname: string;
      status: "not-found";
    }
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

  manifest.routes.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
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

export async function loadPageRoute(
  manifest: RouteManifest,
  pathname: string,
): Promise<PendingRouteMatch> {
  const routeMatch = findRouteMatch(manifest.routes, pathname);

  if (!routeMatch) {
    return {
      notFound: await loadNotFoundFallbackForPath(manifest, pathname),
      pathname,
      status: "not-found",
    };
  }

  const matchingLayouts = manifest.layouts.filter((layout) =>
    isAttachedFileForRoute(layout.fileSegments, routeMatch.route.fileSegments),
  );

  const pageModule = await routeMatch.route.load();

  if (!pageModule.GET || pageModule.GET.kind !== "page") {
    return {
      notFound: await loadNotFoundFallbackForRoute(manifest, routeMatch.route),
      pathname,
      status: "not-found",
    };
  }

  const layoutModules =
    pageModule.GET.layout === false
      ? []
      : await Promise.all(matchingLayouts.map((layout) => layout.load()));

  return {
    status: "ready",
    match: {
      error: await loadErrorFallbackForRoute(manifest, routeMatch.route),
      page: pageModule.GET.view,
      layouts: layoutModules.map(
        (module) => module.default as ComponentType<LayoutProps>,
      ),
      path: routeMatch.path,
      pathname,
    },
  };
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
  const routeMatch = findRouteMatch(manifest.routes, pathname);

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

async function loadNotFoundFallbackForRoute(
  manifest: RouteManifest,
  route: RouteRecord,
) {
  return await loadNotFoundFallbackComponent(
    findClosestAttachedFile(manifest.fallbacks.notFound, route),
  );
}

async function loadNotFoundFallbackForPath(
  manifest: RouteManifest,
  pathname: string,
) {
  return await loadNotFoundFallbackComponent(
    findClosestFallbackForPath(manifest.fallbacks.notFound, pathname),
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
  return fallbackSegments.every(
    (segment, index) => pathnameSegments[index] === segment,
  );
}

async function loadFallbackComponent(fallback: FallbackRoute | undefined) {
  if (!fallback) {
    return undefined;
  }

  const module = await fallback.load();

  return module.default as ComponentType | undefined;
}

async function loadNotFoundFallbackComponent(
  fallback: FallbackRoute | undefined,
) {
  if (!fallback) {
    return undefined;
  }

  const module = await fallback.load();

  return module.default as ComponentType<NotFoundProps> | undefined;
}

async function loadErrorFallbackComponent(fallback: FallbackRoute | undefined) {
  if (!fallback) {
    return undefined;
  }

  const module = await fallback.load();

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
      path[routeSegment.slice(1)] = decodeURIComponent(pathnameSegment);
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
  return pathname.replace(/^\/|\/$/g, "").split("/").filter(Boolean);
}
