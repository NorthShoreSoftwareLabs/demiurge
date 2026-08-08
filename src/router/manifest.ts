import type { ComponentType } from "react";
import type {
  LayoutProps,
  PathVars,
  RouteImporter,
  RouteProps,
} from "../route";

export type RouteRecord = {
  file: string;
  segments: string[];
  score: number;
  load: RouteImporter;
};

export type LayoutRoute = {
  file: string;
  segments: string[];
  load: RouteImporter;
};

export type RouteManifest = {
  routes: RouteRecord[];
  layouts: LayoutRoute[];
};

export type LoadedRouteMatch = {
  page: ComponentType<RouteProps>;
  layouts: ComponentType<LayoutProps>[];
  path: PathVars;
  pathname: string;
};

export type PendingRouteMatch =
  | { status: "loading" }
  | { status: "not-found"; pathname: string }
  | { status: "ready"; match: LoadedRouteMatch };

export function createRouteManifest(routes: Record<string, RouteImporter>) {
  const manifest: RouteManifest = { routes: [], layouts: [] };

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
        segments: toRouteSegments(routePath.slice(0, -1)),
        load,
      });
      continue;
    }

    manifest.routes.push({
      file,
      segments: toRouteSegments(routePath),
      score: scoreRoute(routePath),
      load,
    });
  }

  manifest.routes.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  manifest.layouts.sort((a, b) => a.segments.length - b.segments.length);

  return manifest;
}

export async function loadPageRoute(
  manifest: RouteManifest,
  pathname: string,
): Promise<PendingRouteMatch> {
  const routeMatch = findRouteMatch(manifest.routes, pathname);

  if (!routeMatch) {
    return { status: "not-found", pathname };
  }

  const matchingLayouts = manifest.layouts.filter((layout) =>
    isLayoutForPage(layout.segments, routeMatch.route.segments),
  );

  const pageModule = await routeMatch.route.load();

  if (!pageModule.GET || pageModule.GET.kind !== "page") {
    return { status: "not-found", pathname };
  }

  const layoutModules =
    pageModule.GET.layout === false
      ? []
      : await Promise.all(matchingLayouts.map((layout) => layout.load()));

  return {
    status: "ready",
    match: {
      page: pageModule.GET.view,
      layouts: layoutModules.map(
        (module) => module.default as ComponentType<LayoutProps>,
      ),
      path: routeMatch.path,
      pathname,
    },
  };
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
