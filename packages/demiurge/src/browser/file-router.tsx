import {
  Component,
  ComponentType,
  MouseEvent,
  ReactNode,
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  HYDRATION_FALLBACK_ATTRIBUTE,
  HYDRATION_ROOT_ATTRIBUTE,
  readInitialRouteData,
  type InitialRouteData,
} from "../document";
import {
  isHttpError,
  type NotFoundProps,
  type RouteErrorProps,
  type RouteImporter,
} from "../route";
import {
  createRouteManifest,
  loadErrorFallback,
  loadLoadingFallback,
  loadPageRoute,
  type PendingRouteMatch,
} from "../router";
import { BuiltInNotFound } from "../server/fallbacks";
import { href, type AppHref, type LinkTarget, type LinkTo } from "../routing";

type FileRouterOptions = {
  initialMatch?: PendingRouteMatch;
  routes: Record<string, RouteImporter>;
  loading?: ComponentType;
  notFound?: ComponentType<NotFoundProps>;
};

export function createFileRouter(options: FileRouterOptions) {
  const manifest = createRouteManifest(options.routes);

  return function FileRouter() {
    const [location, setLocation] = useState(() => getCurrentLocation());
    const [match, setMatch] = useState<PendingRouteMatch>(
      () => options.initialMatch ?? { status: "loading" },
    );
    const initialMatchPending = useRef(Boolean(options.initialMatch));

    useEffect(() => {
      function onPopState() {
        setLocation(getCurrentLocation());
      }

      window.addEventListener("popstate", onPopState);
      return () => window.removeEventListener("popstate", onPopState);
    }, []);

    useEffect(() => {
      let cancelled = false;

      if (
        initialMatchPending.current &&
        getMatchPathname(options.initialMatch) === location.pathname
      ) {
        initialMatchPending.current = false;
        return () => {
          cancelled = true;
        };
      }

      setMatch({ status: "loading" });
      loadLoadingFallback(manifest, location.pathname).then((Loading) => {
        if (!cancelled && Loading) {
          setMatch({ loading: Loading, status: "loading" });
        }
      });
      loadPageRoute(manifest, location.pathname)
        .then((nextMatch) => {
          if (!cancelled) {
            setMatch(nextMatch);
          }
        })
        .catch(async (error: unknown) => {
          const ErrorFallback = await loadErrorFallback(
            manifest,
            location.pathname,
          );

          if (!cancelled) {
            setMatch({
              Error: ErrorFallback,
              error,
              pathname: location.pathname,
              status: "error",
            });
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
      children: createElement(RouteRenderer, {
        Loading: options.loading,
        NotFound: options.notFound,
        match,
      }),
    });
  };
}

// Hydration is only safe when the client reproduces what the server sent. A
// page document whose route the client can no longer match is a genuine
// desync, so it keeps getting replaced; a document the server marked as a 404
// hydrates, which is what keeps the layouts it resolved from being torn down.
function isHydratableMatch(match: PendingRouteMatch, root: Element) {
  const fallback = root.getAttribute(HYDRATION_FALLBACK_ATTRIBUTE);

  return match.status === "not-found"
    ? fallback === "not-found"
    : match.status === "ready" && fallback === null;
}

function getMatchPathname(match: PendingRouteMatch | undefined) {
  if (!match) {
    return undefined;
  }

  if (match.status === "ready") {
    return match.match.pathname;
  }

  return match.status === "loading" ? undefined : match.pathname;
}

export type HydrateFileRouterOptions = Omit<
  FileRouterOptions,
  "initialMatch"
> & {
  initialData?: InitialRouteData;
  root?: Element;
};

export async function hydrateFileRouter(options: HydrateFileRouterOptions) {
  const root = options.root ?? document.getElementById("root");

  if (!root) {
    throw new Error(
      "Demiurge expected a #root element in the framework document.",
    );
  }

  const manifest = createRouteManifest(options.routes);
  const match = await loadPageRoute(
    manifest,
    window.location.pathname,
    new Request(window.location.href),
    options.initialData ?? readInitialRouteData(document),
  );
  const hydratable = isHydratableMatch(match, root);
  const Router = createFileRouter(
    hydratable ? { ...options, initialMatch: match } : options,
  );
  const { createRoot, hydrateRoot } = await import("react-dom/client");

  // Only documents rendered by the framework server carry markup to hydrate.
  // A static shell has an empty root, so hydrating it would mismatch. A
  // server-rendered 404 carries markup too, and hydrating it is what keeps the
  // layouts the server resolved from being torn down on the client.
  if (hydratable && root.hasAttribute(HYDRATION_ROOT_ATTRIBUTE)) {
    hydrateRoot(root, createElement(Router));
    return;
  }

  root.replaceChildren();
  createRoot(root).render(createElement(Router));
}

export function Link<const TTo extends AppHref>(
  props: LinkTo<TTo> & {
    children: ReactNode;
    className?: string;
  },
) {
  const router = useRouter();
  const to = href(props as LinkTarget<TTo>);

  return (
    <a
      className={props.className}
      href={to}
      onClick={(event) => {
        if (shouldHandleLinkClick(event)) {
          event.preventDefault();
          router.push(to);
        }
      }}
    >
      {props.children}
    </a>
  );
}

function RouteRenderer({
  Loading,
  NotFound,
  match,
}: {
  Loading?: ComponentType;
  NotFound?: ComponentType<{ pathname: string }>;
  match: PendingRouteMatch;
}) {
  if (match.status === "loading") {
    const AppLoading = match.loading ?? Loading;

    return AppLoading ? createElement(AppLoading) : null;
  }

  if (match.status === "not-found") {
    const AppNotFound = match.notFound ?? NotFound ?? BuiltInNotFound;

    return match.layouts.reduceRight<ReactNode>(
      (children, Layout) =>
        createElement(Layout, {
          children,
          path: {},
          pathname: match.pathname,
        }),
      createElement(AppNotFound, { pathname: match.pathname }),
    );
  }

  if (match.status === "error") {
    return match.Error
      ? createElement(match.Error, {
          error: match.error,
          pathname: match.pathname,
          status: errorStatus(match.error),
        })
      : null;
  }

  const { data, error, page, layouts, path, pathname } = match.match;
  const pageElement = createElement(page, { data, path, pathname });
  const routeElement = layouts.reduceRight<ReactNode>(
    (children, Layout) => createElement(Layout, { path, pathname, children }),
    pageElement,
  );

  return createElement(RouteErrorBoundary, {
    Error: error,
    children: routeElement,
    pathname,
  });
}

class RouteErrorBoundary extends Component<
  {
    children: ReactNode;
    Error?: ComponentType<RouteErrorProps>;
    pathname: string;
  },
  { error?: unknown }
> {
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  override state: { error?: unknown } = {};

  override componentDidUpdate(previousProps: {
    children: ReactNode;
    Error?: ComponentType<RouteErrorProps>;
    pathname: string;
  }) {
    if (
      this.state.error !== undefined &&
      previousProps.pathname !== this.props.pathname
    ) {
      this.setState({ error: undefined });
    }
  }

  override render() {
    if (this.state.error !== undefined) {
      return this.props.Error
        ? createElement(this.props.Error, {
            error: this.state.error,
            pathname: this.props.pathname,
            status: errorStatus(this.state.error),
          })
        : null;
    }

    return this.props.children;
  }
}

function errorStatus(error: unknown) {
  return isHttpError(error) ? error.status : 500;
}

function getCurrentLocation() {
  return {
    pathname: window.location.pathname,
  };
}

function shouldHandleLinkClick(event: MouseEvent<HTMLAnchorElement>) {
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

const RouterContext = createContext<RouterApi>({
  push(to) {
    window.location.href = to;
  },
});

function useRouter() {
  return useContext(RouterContext);
}
