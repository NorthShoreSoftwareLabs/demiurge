import {
  AnchorHTMLAttributes,
  Component,
  ComponentType,
  ForwardedRef,
  Fragment,
  MouseEvent,
  ReactNode,
  createContext,
  createElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  RouteFocusContext,
  type RouteFocusBoundaryElement,
} from "./focus";
import {
  applyNavigationDocument,
  announceNavigation as updateNavigationStatus,
  ensureNavigationStatusRegion,
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

export type NavigationCommit = {
  url: URL;
  kind: "push" | "pop";
  outcome: "ready" | "not-found" | "error";
  title: string;
};

export type NavigationAccessibility = {
  announce?: "title" | false | ((context: NavigationCommit) => string | null);
};

export type FileRouterOptions = {
  initialMatch?: PendingRouteMatch;
  loadNavigationData?: NavigationDataLoader;
  navigation?: "document" | "server";
  routes: Record<string, RouteImporter>;
  loading?: ComponentType;
  navigationAccessibility?: NavigationAccessibility;
  notFound?: ComponentType<NotFoundProps>;
};

export function createFileRouter(options: FileRouterOptions) {
  const manifest = createRouteManifest(options.routes);
  const navigationDataLoader = options.loadNavigationData ?? loadNavigationData;

  return function FileRouter() {
    const [location, setLocation] = useState(() => getCurrentLocation());
    const lastLocation = useRef(location);
    const [match, setMatch] = useState<PendingRouteMatch>(
      () => options.initialMatch ?? { status: "loading" },
    );
    const initialMatchPending = useRef(Boolean(options.initialMatch));
    const navigationSequence = useRef(0);
    const navigationKind = useRef<"push" | "pop">("push");
    const [pendingCommit, setPendingCommit] = useState<NavigationCommit | null>(null);
    const [committed, setCommitted] = useState<NavigationCommit | null>(null);
    const pendingCommitRef = useRef<NavigationCommit | null>(null);
    pendingCommitRef.current = pendingCommit;
    const boundaryRegistrations = useRef<{
      element: RouteFocusBoundaryElement;
      order: number;
    }[]>([]);
    const nextBoundaryOrder = useRef(0);
    const focusRegistration = useMemo(() => ({
      register(element: RouteFocusBoundaryElement) {
        const registration = {
          element,
          order: nextBoundaryOrder.current++,
        };
        if (
          boundaryRegistrations.current.length > 0 &&
          typeof process !== "undefined" &&
          process.env.NODE_ENV !== "production"
        ) {
          console.warn(
            "Demiurge found more than one RouteFocusBoundary. The first boundary remains active.",
          );
        }
        boundaryRegistrations.current.push(registration);

        return () => {
          const index = boundaryRegistrations.current.indexOf(registration);
          if (index !== -1) boundaryRegistrations.current.splice(index, 1);
        };
      },
      focus() {
        const active = boundaryRegistrations.current
          .slice()
          .sort((left, right) => left.order - right.order)[0]?.element;
        if (!active || !active.isConnected || typeof active.focus !== "function") {
          return false;
        }

        try {
          active.focus({ preventScroll: true });
        } catch {
          active.focus();
        }
        return true;
      },
    }), []);

    useLayoutEffect(() => {
      if (options.navigation !== "document") {
        ensureNavigationStatusRegion();
      }
      return () => {
        boundaryRegistrations.current = [];
      };
    }, [options.navigation]);

    useEffect(() => {
      function onPopState() {
        navigationKind.current = "pop";
        const next = getCurrentLocation();
        const previous = lastLocation.current;
        lastLocation.current = next;
        if (
          previous.pathname === next.pathname &&
          previous.search === next.search &&
          previous.hash !== next.hash
        ) {
          scrollToHash(next.hash);
        }
        setLocation(next);
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

      setPendingCommit(null);
      setCommitted(null);

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
        .then(async (initialData) => ({
          initialData,
          nextMatch: await loadPageRoute(
            manifest,
            location.pathname,
            request,
            initialData,
            undefined,
            { documentContributions: false },
          ),
        }))
        .then(({ initialData, nextMatch }) => {
          settled = true;
          if (isCurrent()) {
            if (initialData.document) {
              applyNavigationDocument(initialData.document);
            }
            setMatch(nextMatch);
            setPendingCommit({
              kind: navigationKind.current,
              outcome: nextMatch.status === "not-found" ? "not-found" : "ready",
              title: document.title || "Demiurge App",
              url: new URL(location.href),
            });
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
            const navigationDocument = typeof error === "object" && error
              ? navigationErrorDocuments.get(error)
              : undefined;
            if (navigationDocument) {
              applyNavigationDocument(navigationDocument);
            }
            setMatch({
              Error: ErrorFallback,
              error,
              pathname: location.pathname,
              status: "error",
            });
            setPendingCommit({
              kind: navigationKind.current,
              outcome: "error",
              title: navigationDocument?.title ?? "Navigation failed",
              url: new URL(location.href),
            });
          }
        });

      return () => {
        cancelled = true;
        controller.abort();
      };
    }, [location.pathname, location.search]);

    useLayoutEffect(() => {
      if (!committed || options.navigation === "document") {
        return;
      }

      if (committed.url.hash) {
        scrollToHash(committed.url.hash);
        return;
      }

      focusRegistration.focus();
      announceNavigation(committed, options.navigationAccessibility);
    }, [
      committed,
      focusRegistration,
      options.navigation,
      options.navigationAccessibility,
    ]);

    const router = useMemo(
      () => ({
        navigation: options.navigation ?? "server",
        push(to: string) {
          const previous = getCurrentLocation();
          window.history.pushState(null, "", to);
          const next = getCurrentLocation();
          lastLocation.current = next;
          setLocation(next);

          if (
            previous.pathname === next.pathname &&
            previous.search === next.search &&
            previous.hash !== next.hash
          ) {
            scrollToHash(next.hash);
          }
          navigationKind.current = "push";
        },
      }),
      [],
    );

    return createElement(RouterContext.Provider, {
      value: router,
    children: createElement(RouteFocusContext.Provider, {
        value: focusRegistration,
        children: createElement(RouteRenderer, {
          key: `${location.pathname}${location.search}`,
          Loading: options.loading,
          NotFound: options.notFound,
          match,
          pendingCommit,
          onCommitted: (value) => {
            if (pendingCommitRef.current === value) setCommitted(value);
          },
          onRenderError: () => {
            setCommitted(pendingCommit
              ? { ...pendingCommit, outcome: "error", title: "Navigation failed" }
              : null);
          },
        }),
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
  // TYPE-EVIDENCE: the runtime checks confirm both client functions exist. The module therefore matches the client API shape.
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

type DataAttributes = {
  [TName in `data-${string}`]?: string | number | undefined;
};

export type LinkProps<TTo extends AppHref = AppHref> = LinkTo<TTo> &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    reloadDocument?: boolean;
  } & DataAttributes;

function LinkImplementation<const TTo extends AppHref>(
  props: LinkProps<TTo>,
  ref: ForwardedRef<HTMLAnchorElement>,
) {
  const router = useRouter();
  const {
    children,
    download,
    hash: _hash,
    onClick,
    path: _path,
    reloadDocument,
    search: _search,
    target,
    to: _to,
    ...anchorProps
  } = props;
  // TYPE-EVIDENCE: href reads only the typed destination fields from LinkProps.
  const to = href(props as LinkTarget<TTo>);

  return (
    <a
      {...anchorProps}
      download={download}
      href={to}
      ref={ref}
      target={target}
      onClick={(event) => {
        onClick?.(event);

        if (
          router.navigation === "server" &&
          !reloadDocument &&
          shouldHandleLinkClick(event, { download, target, to })
        ) {
          event.preventDefault();
          router.push(to);
        }
      }}
    >
      {children}
    </a>
  );
}

export function Link<const TTo extends AppHref>(
  props: LinkProps<TTo> & { ref?: ForwardedRef<HTMLAnchorElement> },
) {
  return LinkImplementation(props, props.ref ?? null);
}

function RouteRenderer({
  Loading,
  NotFound,
  match,
  onRenderError,
  onCommitted,
  pendingCommit,
}: {
  Loading?: ComponentType;
  NotFound?: ComponentType<{ pathname: string }>;
  match: PendingRouteMatch;
  onCommitted: (value: NavigationCommit) => void;
  onRenderError: () => void;
  pendingCommit: NavigationCommit | null;
}) {
  if (match.status === "loading") {
    const AppLoading = match.loading ?? Loading;

    return AppLoading ? createElement(AppLoading) : null;
  }

  if (match.status === "not-found") {
    const AppNotFound = match.notFound ?? NotFound ?? BuiltInNotFound;

    return createElement(Fragment, null, match.layouts.reduceRight<ReactNode>(
      (children, Layout) =>
        createElement(Layout, {
          children,
          path: {},
          pathname: match.pathname,
        }),
      createElement(AppNotFound, { pathname: match.pathname }),
    ), createElement(NavigationCommitMarker, { commit: pendingCommit, onCommit: onCommitted }));
  }

  if (match.status === "error") {
    return createElement(Fragment, null, match.Error
      ? createElement(match.Error, {
          error: match.error,
          pathname: match.pathname,
          status: errorStatus(match.error),
        })
      : null, createElement(NavigationCommitMarker, { commit: pendingCommit, onCommit: onCommitted }));
  }

  const { data, error, page, layouts, path, pathname } = match.match;
  const pageElement = createElement(page, { data, path, pathname });
  const routeElement = layouts.reduceRight<ReactNode>(
    (children, Layout) => createElement(Layout, { path, pathname, children }),
    pageElement,
  );

  return createElement(RouteErrorBoundary, {
    Error: error,
      children: createElement(Fragment, null, routeElement, createElement(NavigationCommitMarker, { commit: pendingCommit, onCommit: onCommitted })),
    onError: onRenderError,
    pathname,
  });
}

function NavigationCommitMarker({
  commit,
  onCommit,
}: {
  commit: NavigationCommit | null;
  onCommit: (value: NavigationCommit) => void;
}) {
  const signaled = useRef<NavigationCommit | null>(null);
  useLayoutEffect(() => {
    if (commit && signaled.current !== commit) {
      signaled.current = commit;
      onCommit(commit);
    }
  }, [commit, onCommit]);
  return null;
}

class RouteErrorBoundary extends Component<
  {
    children: ReactNode;
    Error?: ComponentType<RouteErrorProps>;
    onError: () => void;
    pathname: string;
  },
  { error?: unknown }
> {
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  override state: { error?: unknown } = {};

  override componentDidCatch() {
    this.props.onError();
  }

  override componentDidUpdate(previousProps: {
    children: ReactNode;
    Error?: ComponentType<RouteErrorProps>;
    onError: () => void;
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
    // TYPE-EVIDENCE: the response body is JSON that the server serialized as initial route data. The next check validates the required hasData field.
    const value = await response.json() as Partial<InitialRouteData>;

    if (value.hasData !== true) {
      throw new Error("Demiurge received malformed navigation route data.");
    }

    return {
      data: value.data,
      document: value.document,
      hasData: true,
    };
  }

  if (kind === NAVIGATION_NOT_FOUND_RESPONSE) {
    const value = await readNavigationPayload(response);
    return {
      document: value?.document,
      hasData: true,
    };
  }

  if (kind === NAVIGATION_ERROR_RESPONSE || !response.ok) {
    const value = await readNavigationPayload(response);
    // TYPE-EVIDENCE: the includes check confirms the status is a member of the error status tuple. The second cast reuses that same narrowing.
    const status = HTTP_ERROR_STATUSES.includes(
      response.status as (typeof HTTP_ERROR_STATUSES)[number],
    )
      ? response.status as (typeof HTTP_ERROR_STATUSES)[number]
      : 500;

    const error = httpError(status, {
      detail: value?.error?.detail,
      title: value?.error?.title,
    });
    if (value?.document) {
      navigationErrorDocuments.set(error, value.document);
    }
    throw error;
  }

  throw new Error(
    "Demiurge expected a navigation data response from the application server.",
  );
}

const navigationErrorDocuments = new WeakMap<
  object,
  InitialRouteData["document"]
>();

async function readNavigationPayload(response: Response) {
  try {
    // TYPE-EVIDENCE: a marked navigation response is serialized by createNavigationDataResponse. The server validates the resolved contribution types before serialization.
    return await response.json() as Partial<InitialRouteData>;
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

function shouldHandleLinkClick(
  event: MouseEvent<HTMLAnchorElement>,
  options: {
    download?: AnchorHTMLAttributes<HTMLAnchorElement>["download"];
    target?: string;
    to: string;
  },
) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.altKey ||
    event.ctrlKey ||
    event.shiftKey ||
    options.download !== undefined && options.download !== false ||
    options.target !== undefined && options.target.toLowerCase() !== "_self"
  ) {
    return false;
  }

  const destination = new URL(options.to, window.location.href);

  return (
    (destination.protocol === "http:" || destination.protocol === "https:") &&
    destination.origin === window.location.origin
  );
}

function announceNavigation(
  commit: NavigationCommit,
  options: NavigationAccessibility | undefined,
) {
  const announce = options?.announce ?? "title";
  if (announce === false) return;

  let message: string | null;
  try {
    message = announce === "title" ? commit.title : announce(commit);
  } catch {
    return;
  }

  if (message) {
    announceNavigationRegion(message);
  }
}

function announceNavigationRegion(message: string) {
  updateNavigationStatus(message);
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
