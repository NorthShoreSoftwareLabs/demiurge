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
  startDeferredScripts,
  type InitialRouteData,
} from "../document";
import {
  HTTP_ERROR_STATUSES,
  httpError,
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
  NAVIGATION_DATA_HEADER,
  NAVIGATION_DATA_REQUEST,
  NAVIGATION_DATA_RESPONSE,
  NAVIGATION_ERROR_RESPONSE,
  NAVIGATION_NOT_FOUND_RESPONSE,
  type PendingRouteMatch,
} from "../router";
import { BuiltInNotFound } from "../server/fallbacks";
import { href, type AppHref, type LinkTarget, type LinkTo } from "../routing";

export type NavigationDataLoader = (
  request: Request,
) => Promise<InitialRouteData>;

export type FileRouterOptions = {
  initialMatch?: PendingRouteMatch;
  loadNavigationData?: NavigationDataLoader;
  navigation?: "document" | "server";
  routes: Record<string, RouteImporter>;
  loading?: ComponentType;
  notFound?: ComponentType<NotFoundProps>;
};

export function createFileRouter(options: FileRouterOptions) {
  const manifest = createRouteManifest(options.routes);
  const navigationDataLoader = options.loadNavigationData ?? loadNavigationData;

  return function FileRouter() {
    const [location, setLocation] = useState(() => getCurrentLocation());
    const [match, setMatch] = useState<PendingRouteMatch>(
      () => options.initialMatch ?? { status: "loading" },
    );
    const initialMatchPending = useRef(Boolean(options.initialMatch));
    const navigationSequence = useRef(0);

    useEffect(() => {
      function onPopState() {
        setLocation(getCurrentLocation());
      }

      window.addEventListener("popstate", onPopState);
      return () => window.removeEventListener("popstate", onPopState);
    }, []);

    useEffect(() => {
      let cancelled = false;
      let settled = false;
      const sequence = ++navigationSequence.current;
      const controller = new AbortController();
      const isCurrent = () =>
        !cancelled && sequence === navigationSequence.current;

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
        if (isCurrent() && !settled && Loading) {
          setMatch({ loading: Loading, status: "loading" });
        }
      }).catch(() => {
        // Loading UI is optional. A malformed pathname or broken loading
        // module must not become an unhandled rejection while the main route
        // pipeline resolves the controlled error state.
      });
      const request = new Request(location.href, { signal: controller.signal });
      Promise.resolve(navigationDataLoader(request))
        .then((initialData) =>
          loadPageRoute(
            manifest,
            location.pathname,
            request,
            initialData,
            undefined,
            { documentContributions: false },
          ),
        )
        .then((nextMatch) => {
          settled = true;
          if (isCurrent()) {
            setMatch(nextMatch);
          }
        })
        .catch(async (error: unknown) => {
          settled = true;

          if (!isCurrent() || controller.signal.aborted) {
            return;
          }

          const ErrorFallback = await loadErrorFallback(
            manifest,
            location.pathname,
          );

          if (isCurrent()) {
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
        controller.abort();
      };
    }, [location.pathname, location.search]);

    const router = useMemo(
      () => ({
        navigation: options.navigation ?? "server",
        push(to: string) {
          const previous = getCurrentLocation();
          window.history.pushState(null, "", to);
          const next = getCurrentLocation();
          setLocation(next);

          if (
            previous.pathname === next.pathname &&
            previous.search === next.search &&
            previous.hash !== next.hash
          ) {
            scrollToHash(next.hash);
          }
        },
      }),
      [],
    );

    return createElement(RouterContext.Provider, {
      value: router,
      children: createElement(RouteRenderer, {
        key: `${location.pathname}${location.search}`,
        Loading: options.loading,
        NotFound: options.notFound,
        match,
      }),
    });
  };
}

// Hydration is safe only when the client reproduces the server output. The
// client replaces a page document when its route no longer matches. The client
// hydrates a document that the server marked as a 404. This action preserves
// the layouts that the server resolved.
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
  const navigationDataLoader = options.loadNavigationData ?? loadNavigationData;
  const initialData = options.initialData ?? readInitialRouteData(document);
  const match = await loadPageRoute(
    manifest,
    window.location.pathname,
    new Request(window.location.href),
    initialData ?? await navigationDataLoader(new Request(window.location.href)),
    undefined,
    { documentContributions: false },
  );
  const hydratable = isHydratableMatch(match, root);
  const Router = createFileRouter(
    hydratable
      ? {
        ...options,
        initialMatch: match,
        loadNavigationData: navigationDataLoader,
        navigation: initialData?.navigation ?? options.navigation,
      }
      : {
        ...options,
        loadNavigationData: navigationDataLoader,
        navigation: initialData?.navigation ?? options.navigation,
      },
  );
  const { createRoot, hydrateRoot } = resolveReactDomClient(
    await import("react-dom/client"),
  );

  // Only documents rendered by the framework server carry markup to hydrate.
  // A static shell has an empty root, so hydrating it would mismatch. A
  // server-rendered 404 carries markup too, and hydrating it is what keeps the
  // layouts the server resolved from being torn down on the client.
  if (hydratable && root.hasAttribute(HYDRATION_ROOT_ATTRIBUTE)) {
    hydrateRoot(root, createElement(Router));
    startDeferredScripts();
    return;
  }

  root.replaceChildren();
  createRoot(root).render(createElement(Router));
  startDeferredScripts();
}

type ReactDomClientApi = Pick<
  typeof import("react-dom/client"),
  "createRoot" | "hydrateRoot"
>;

type ReactDomClientModule = Partial<ReactDomClientApi> & {
  default?: ReactDomClientApi;
};

export function resolveReactDomClient(module: ReactDomClientModule) {
  // SAFETY: the runtime checks confirm both client functions exist. The module therefore matches the client API shape.
  const client = typeof module.createRoot === "function" &&
      typeof module.hydrateRoot === "function"
    ? module as ReactDomClientApi
    : module.default;

  if (
    !client ||
    typeof client.createRoot !== "function" ||
    typeof client.hydrateRoot !== "function"
  ) {
    throw new Error(
      "Demiurge could not load the React DOM client from the Vite module.",
    );
  }

  return client;
}

export function Link<const TTo extends AppHref>(
  props: LinkTo<TTo> & {
    children: ReactNode;
    className?: string;
  },
) {
  const router = useRouter();
  // SAFETY: the props type adds only children and className to a link target. The cast removes those extra fields.
  const to = href(props as LinkTarget<TTo>);

  return (
    <a
      className={props.className}
      href={to}
      onClick={(event) => {
        if (
          router.navigation === "server" &&
          shouldHandleLinkClick(event)
        ) {
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
    hash: window.location.hash,
    href: window.location.href,
    pathname: window.location.pathname,
    search: window.location.search,
  };
}

async function loadNavigationData(request: Request) {
  const headers = new Headers(request.headers);
  headers.set("accept", "application/json");
  headers.set(NAVIGATION_DATA_HEADER, NAVIGATION_DATA_REQUEST);
  const response = await fetch(new Request(request, {
    credentials: "same-origin",
    headers,
  }));
  const kind = response.headers.get(NAVIGATION_DATA_HEADER);

  if (kind === NAVIGATION_DATA_RESPONSE) {
    // SAFETY: the response body is JSON that the server serialized as initial route data. The next check validates the required hasData field.
    const value = await response.json() as Partial<InitialRouteData>;

    if (value.hasData !== true) {
      throw new Error("Demiurge received malformed navigation route data.");
    }

    return { data: value.data, hasData: true };
  }

  if (kind === NAVIGATION_NOT_FOUND_RESPONSE) {
    return { hasData: true };
  }

  if (kind === NAVIGATION_ERROR_RESPONSE || !response.ok) {
    const problem = await readProblem(response);
    // SAFETY: the includes check confirms the status is a member of the error status tuple. The second cast reuses that same narrowing.
    const status = HTTP_ERROR_STATUSES.includes(
      response.status as (typeof HTTP_ERROR_STATUSES)[number],
    )
      ? response.status as (typeof HTTP_ERROR_STATUSES)[number]
      : 500;

    throw httpError(status, {
      detail: typeof problem?.detail === "string" ? problem.detail : undefined,
      title: typeof problem?.title === "string" ? problem.title : undefined,
    });
  }

  throw new Error(
    "Demiurge expected a navigation data response from the application server.",
  );
}

async function readProblem(response: Response) {
  try {
    // SAFETY: the response body is JSON that parses to a plain object. The record type describes any JSON object.
    return await response.json() as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function scrollToHash(hash: string) {
  queueMicrotask(() => {
    if (!hash) {
      window.scrollTo?.(0, 0);
      return;
    }

    let id: string;
    try {
      id = decodeURIComponent(hash.slice(1));
    } catch {
      id = hash.slice(1);
    }
    document.getElementById(id)?.scrollIntoView?.();
  });
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
  navigation: "document" | "server";
  push(to: string): void;
};

const RouterContext = createContext<RouterApi>({
  navigation: "document",
  push(to) {
    window.location.href = to;
  },
});

function useRouter() {
  return useContext(RouterContext);
}
