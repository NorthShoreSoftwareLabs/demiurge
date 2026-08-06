import {
  ComponentType,
  MouseEvent,
  ReactNode,
  createContext,
  createElement,
  useEffect,
  useContext,
  useMemo,
  useState,
} from "react";

export type PathVars = Record<string, string>;

export type RouteProps = {
  path: PathVars;
  pathname: string;
};

export type LayoutProps = RouteProps & {
  children: ReactNode;
};

export type PageCapability = {
  kind: "page";
  view: ComponentType<RouteProps>;
  layout?: false;
};

export type PageOptions = {
  view: ComponentType<RouteProps>;
  layout?: false;
};

export type RouteModule = {
  GET?: PageCapability;
  default?: ComponentType<LayoutProps>;
};

type RouteImporter = () => Promise<RouteModule>;

type FileRouterOptions = {
  routes: Record<string, RouteImporter>;
};

type PageRoute = {
  file: string;
  segments: string[];
  score: number;
  load: RouteImporter;
};

type LayoutRoute = {
  file: string;
  segments: string[];
  load: RouteImporter;
};

type RouteManifest = {
  pages: PageRoute[];
  layouts: LayoutRoute[];
};

type LoadedMatch = {
  page: ComponentType<RouteProps>;
  layouts: ComponentType<LayoutProps>[];
  path: PathVars;
  pathname: string;
};

type PendingMatch =
  | { status: "loading" }
  | { status: "not-found"; pathname: string }
  | { status: "ready"; match: LoadedMatch };

export function createFileRouter(options: FileRouterOptions) {
  const manifest = unstable_createRouteManifest(options.routes);

  return function FileRouter() {
    const [location, setLocation] = useState(() => getCurrentLocation());
    const [match, setMatch] = useState<PendingMatch>({ status: "loading" });

    useEffect(() => {
      function onPopState() {
        setLocation(getCurrentLocation());
      }

      window.addEventListener("popstate", onPopState);
      return () => window.removeEventListener("popstate", onPopState);
    }, []);

    useEffect(() => {
      let cancelled = false;

      setMatch({ status: "loading" });
      unstable_loadRoute(manifest, location.pathname).then((nextMatch) => {
        if (!cancelled) {
          setMatch(nextMatch);
        }
      });

      return () => {
        cancelled = true;
      };
    }, [location.pathname]);

    const router = useMemo(
      () => ({
        push(to: string) {
          window.history.pushState(null, "", to);
          setLocation(getCurrentLocation());
        },
      }),
      [],
    );

    return createElement(RouterContext.Provider, {
      value: router,
      children: createElement(RouteRenderer, { match }),
    });
  };
}

export function page(options: PageOptions | ComponentType<RouteProps>) {
  if (typeof options === "function") {
    return {
      kind: "page",
      view: options,
    } satisfies PageCapability;
  }

  return {
    kind: "page",
    view: options.view,
    layout: options.layout,
  } satisfies PageCapability;
}

export function Link(props: {
  to: string;
  children: ReactNode;
  className?: string;
}) {
  const router = useRouter();

  return (
    <a
      className={props.className}
      href={props.to}
      onClick={(event) => {
        if (shouldHandleLinkClick(event)) {
          event.preventDefault();
          router.push(props.to);
        }
      }}
    >
      {props.children}
    </a>
  );
}

function RouteRenderer({ match }: { match: PendingMatch }) {
  if (match.status === "loading") {
    return <main className="page-shell">Loading...</main>;
  }

  if (match.status === "not-found") {
    return (
      <main className="page-shell">
        <h1>Not found</h1>
        <p>No route matched {match.pathname}.</p>
      </main>
    );
  }

  const { page, layouts, path, pathname } = match.match;
  const pageElement = createElement(page, { path, pathname });

  return layouts.reduceRight(
    (children, Layout) => createElement(Layout, { path, pathname, children }),
    pageElement,
  );
}

export async function unstable_loadRoute(
  manifest: RouteManifest,
  pathname: string,
): Promise<PendingMatch> {
  const pageMatch = unstable_findPageMatch(manifest.pages, pathname);

  if (!pageMatch) {
    return { status: "not-found", pathname };
  }

  const matchingLayouts = manifest.layouts.filter((layout) =>
    unstable_isLayoutForPage(layout.segments, pageMatch.page.segments),
  );

  const pageModule = await pageMatch.page.load();

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
      path: pageMatch.path,
      pathname,
    },
  };
}

export function unstable_createRouteManifest(
  routes: Record<string, RouteImporter>,
) {
  const manifest: RouteManifest = { pages: [], layouts: [] };

  for (const [file, load] of Object.entries(routes)) {
    const routePath = file
      .replace(/^\.\/routes\//, "")
      .replace(/\.tsx$/, "")
      .split("/");

    const basename = routePath.at(-1);

    if (basename === "@layout") {
      manifest.layouts.push({
        file,
        segments: unstable_toRouteSegments(routePath.slice(0, -1)),
        load,
      });
      continue;
    }

    manifest.pages.push({
      file,
      segments: unstable_toRouteSegments(routePath),
      score: unstable_scoreRoute(routePath),
      load,
    });
  }

  manifest.pages.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  manifest.layouts.sort((a, b) => a.segments.length - b.segments.length);

  return manifest;
}

export function unstable_findPageMatch(pages: PageRoute[], pathname: string) {
  const pathnameSegments = unstable_splitPathname(pathname);

  for (const page of pages) {
    const path = unstable_matchSegments(page.segments, pathnameSegments);

    if (path) {
      return { page, path };
    }
  }

  return null;
}

export function unstable_matchSegments(
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

export function unstable_isLayoutForPage(
  layoutSegments: string[],
  pageSegments: string[],
) {
  return layoutSegments.every(
    (segment, index) => pageSegments[index] === segment,
  );
}

export function unstable_toRouteSegments(fileSegments: string[]) {
  return fileSegments.flatMap((segment) => {
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

export function unstable_scoreRoute(fileSegments: string[]) {
  return unstable_toRouteSegments(fileSegments).reduce((score, segment) => {
    if (segment.startsWith("*")) {
      return score;
    }

    if (segment.startsWith(":")) {
      return score + 1;
    }

    return score + 2;
  }, 0);
}

export function unstable_splitPathname(pathname: string) {
  return pathname.replace(/^\/|\/$/g, "").split("/").filter(Boolean);
}

function getCurrentLocation() {
  return {
    pathname: window.location.pathname,
  };
}

function shouldHandleLinkClick(
  event: MouseEvent<HTMLAnchorElement>,
) {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey
  );
}

type RouterApi = {
  push(to: string): void;
};

const RouterContext = ReactContext<RouterApi>({
  push(to) {
    window.location.href = to;
  },
});

function useRouter() {
  return RouterContext.use();
}

function ReactContext<T>(defaultValue: T) {
  const context = createContext(defaultValue);

  return {
    Provider: context.Provider,
    use() {
      return useContext(context);
    },
  };
}
