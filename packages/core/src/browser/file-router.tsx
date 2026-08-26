import {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  Component,
  ComponentType,
  ForwardedRef,
  FormEvent,
  FormHTMLAttributes,
  Fragment,
  MouseEvent,
  ReactNode,
  createContext,
  createElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useId,
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
import { applicationPathname, href, localizeHref, type AppHref, type AppLocale, type LinkTarget, type LinkTo, type LocaleConfiguration } from "../routing";
import {
  abortMutationActions,
  mutationFormActionDetails,
  performMutationRequest,
  registerMutationRouter,
  type MutationFormAction,
  type MutationResult,
  validateMutationRedirect,
} from "./mutation-action";

export type NavigationDataLoader = (
  request: Request,
) => Promise<InitialRouteData>;

export type NavigationCommit = {
  url: URL;
  kind: "push" | "replace" | "pop";
  outcome: "ready" | "not-found" | "error";
  title: string;
};

export type NavigationScrollContext = NavigationCommit & {
  navigation: NavigationCommit["kind"];
  position?: { x: number; y: number };
};

export type NavigationScrollOption =
  | false
  | "top"
  | ((context: NavigationScrollContext) => void);

export type NavigationAccessibility = {
  announce?: "title" | false | ((context: NavigationCommit) => string | null);
};

export type MutationNavigationState<TData = unknown, TField extends string = string> =
  | { state: "idle"; form?: HTMLFormElement; submissionKey?: string; result?: MutationResult<TData, TField> }
  | { state: "submitting"; form: HTMLFormElement; submissionKey?: string; formData: FormData }
  | { state: "loading"; form: HTMLFormElement; submissionKey?: string; formData: FormData; result?: Extract<MutationResult<TData, TField>, { status: "success" }> }
  | { state: "invalid"; form: HTMLFormElement; submissionKey?: string; formData: FormData; result: Extract<MutationResult<TData, TField>, { status: "invalid" }> }
  | { state: "error"; form: HTMLFormElement; submissionKey?: string; formData: FormData; response?: Response };

export type FormProps =
  | (Omit<FormHTMLAttributes<HTMLFormElement>, "action"> & {
    action?: string;
    submissionKey?: string;
  })
  | (Omit<FormHTMLAttributes<HTMLFormElement>, "action" | "method"> & {
    action: MutationFormAction;
    method?: never;
    submissionKey?: never;
  });

export type MutationSubmitProps =
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "formAction" | "formMethod"> & {
    formAction: MutationFormAction;
    formMethod?: never;
  };

export type FileRouterOptions = {
  initialMatch?: PendingRouteMatch;
  loadNavigationData?: NavigationDataLoader;
  navigation?: "document" | "server";
  routes: Record<string, RouteImporter>;
  locales?: LocaleConfiguration;
  locale?: string;
  loading?: ComponentType;
  navigationAccessibility?: NavigationAccessibility;
  navigationScroll?: NavigationScrollOption;
  notFound?: ComponentType<NotFoundProps>;
};

export function createFileRouter(options: FileRouterOptions) {
  const manifest = createRouteManifest(options.routes);
  const navigationDataLoader = options.loadNavigationData ?? loadNavigationData;

  return function FileRouter() {
    const [location, setLocation] = useState(() => getCurrentLocation());
    const [locale, setLocale] = useState(options.locale);
    const routePathname = applicationPathname(location.pathname, options.locales);
    const lastLocation = useRef(location);
    const [match, setMatch] = useState<PendingRouteMatch>(
      () => options.initialMatch ?? { status: "loading" },
    );
    const initialMatchPending = useRef(Boolean(options.initialMatch));
    const initialNavigationPending = useRef(true);
    const navigationSequence = useRef(0);
    const routeLoadController = useRef<AbortController | undefined>(undefined);
    const routeLoadCause = useRef<"navigation" | "refresh">("navigation");
    const submissionControllers = useRef(new Map<string, AbortController>());
    const submissionStates = useRef(new Map<string, MutationNavigationState>());
    const [submissionVersion, setSubmissionVersion] = useState(0);
    const [routeRefresh, setRouteRefresh] = useState(0);
    const routeRefreshWaiters = useRef(new Set<() => void>());
    const [resolvedRouteVersion, setResolvedRouteVersion] = useState(0);
    const navigationKind = useRef<"push" | "replace" | "pop">("push");
    const [pendingCommit, setPendingCommit] = useState<NavigationCommit | null>(null);
    const [committed, setCommitted] = useState<NavigationCommit | null>(null);
    const pendingCommitRef = useRef<NavigationCommit | null>(null);
    pendingCommitRef.current = pendingCommit;
    const pendingScroll = useRef<PendingScroll | undefined>(undefined);
    const pendingPopPosition = useRef<ScrollPosition | undefined>(undefined);
    const activeHistoryEntry = useRef<string | undefined>(undefined);
    const restoringScroll = useRef(false);
    const scrollPositions = useRef(new Map<string, ScrollPosition>());
    const boundaryRegistrations = useRef<{
      element: RouteFocusBoundaryElement;
      order: number;
    }[]>([]);
    const nextBoundaryOrder = useRef(0);

    function saveCurrentScrollPosition() {
      const entry = activeHistoryEntry.current;
      const position = currentScrollPosition();
      if (entry) scrollPositions.current.set(entry, position);
      rememberScrollPosition(entry, position);
    }
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

    useEffect(() => () => {
      abortMutationActions();
      for (const resolve of routeRefreshWaiters.current) resolve();
      routeRefreshWaiters.current.clear();
      for (const controller of submissionControllers.current.values()) controller.abort();
      submissionControllers.current.clear();
      submissionStates.current.clear();
    }, []);

    function abortSubmissions(except?: AbortController) {
      abortMutationActions(except);
      let changed = false;
      for (const [key, controller] of submissionControllers.current) {
        if (controller === except) continue;
        controller.abort();
        submissionControllers.current.delete(key);
        const state = submissionStates.current.get(key);
        if (state?.state === "submitting" || state?.state === "loading") {
          submissionStates.current.set(key, {
            state: "idle",
            form: state.form,
            submissionKey: state.submissionKey,
            ...(state.state === "loading" && state.result ? { result: state.result } : {}),
          });
        }
        changed = true;
      }
      if (changed) setSubmissionVersion((value) => value + 1);
    }

    function supersedeRouteLoad() {
      navigationSequence.current++;
      routeLoadController.current?.abort();
      routeLoadController.current = undefined;
    }

    useEffect(() => {
      if (options.navigation === "document") {
        return;
      }

      const previousRestoration = window.history.scrollRestoration;
      window.history.scrollRestoration = "manual";
      activeHistoryEntry.current = ensureHistoryEntry();
      saveCurrentScrollPosition();
      const onScroll = () => {
        if (!restoringScroll.current) {
          saveCurrentScrollPosition();
        }
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        window.removeEventListener("scroll", onScroll);
        window.history.scrollRestoration = previousRestoration;
      };
    }, [options.navigation]);

    useEffect(() => {
      function onPopState() {
        abortSubmissions();
        navigationKind.current = "pop";
        restoringScroll.current = true;
        activeHistoryEntry.current = ensureHistoryEntry();
        pendingPopPosition.current = scrollPositions.current.get(
          activeHistoryEntry.current,
        ) ?? readScrollPosition();
        const next = getCurrentLocation();
        const previous = lastLocation.current;
        if (previous.pathname !== next.pathname || previous.search !== next.search) {
          supersedeRouteLoad();
          routeLoadCause.current = "navigation";
        }
        lastLocation.current = next;
        if (
          options.navigation !== "document" &&
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
      routeLoadController.current = controller;
      const cause = routeLoadCause.current;
      const isCurrent = () =>
        !cancelled && sequence === navigationSequence.current;

      setPendingCommit(null);
      setCommitted(null);

      if (
        initialMatchPending.current &&
        getMatchPathname(options.initialMatch) === routePathname
      ) {
        initialMatchPending.current = false;
        initialNavigationPending.current = false;
        return () => {
          cancelled = true;
          controller.abort();
          if (routeLoadController.current === controller) {
            routeLoadController.current = undefined;
          }
        };
      }

      const initialNavigation = initialNavigationPending.current;
      initialNavigationPending.current = false;

      if (
        cause !== "refresh" &&
        options.navigation !== "document" &&
        !initialNavigation
      ) {
        pendingScroll.current = {
          navigation: navigationKind.current,
          position: navigationKind.current === "pop"
            ? pendingPopPosition.current
            : undefined,
        };
        pendingPopPosition.current = undefined;
      }

      if (cause !== "refresh") {
        setMatch({ status: "loading" });
        loadLoadingFallback(manifest, routePathname).then((Loading) => {
          if (isCurrent() && !settled && Loading) {
            setMatch({ loading: Loading, status: "loading" });
          }
        }).catch(() => {
          // Loading UI is optional. A malformed pathname or broken loading
          // module must not become an unhandled rejection while the main route
          // pipeline resolves the controlled error state.
        });
      }
      const request = new Request(location.href, { signal: controller.signal });
      Promise.resolve(navigationDataLoader(request))
        .then(async (initialData) => ({
          initialData,
          nextMatch: await loadPageRoute(
            manifest,
            routePathname,
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
            if ("locale" in initialData && initialData.locale) {
              setLocale(initialData.locale);
            }
            setMatch(nextMatch);
            setResolvedRouteVersion((value) => value + 1);
            if (cause !== "refresh") {
              setPendingCommit({
                kind: navigationKind.current,
                outcome: nextMatch.status === "not-found" ? "not-found" : "ready",
                title: document.title || "Demiurge App",
                url: new URL(location.href),
              });
            }
          }
        })
        .catch(async (error: unknown) => {
          settled = true;

          if (!isCurrent() || controller.signal.aborted) {
            return;
          }

          const ErrorFallback = await loadErrorFallback(
            manifest,
            routePathname,
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
              pathname: routePathname,
              status: "error",
            });
            setPendingCommit(cause === "refresh"
              ? null
              : {
                kind: navigationKind.current,
                outcome: "error",
                title: navigationDocument?.title ?? "Navigation failed",
                url: new URL(location.href),
              });
            setResolvedRouteVersion((value) => value + 1);
          }
        });

      return () => {
        cancelled = true;
        controller.abort();
        if (routeLoadController.current === controller) {
          routeLoadController.current = undefined;
        }
      };
    }, [routePathname, location.search, routeRefresh]);

    useLayoutEffect(() => {
      if (!committed || options.navigation === "document") {
        return;
      }

      if (committed.url.hash) {
        if (pendingScroll.current) {
          pendingScroll.current = undefined;
          scrollToHash(committed.url.hash);
        }
        restoringScroll.current = false;
        return;
      }

      focusRegistration.focus();
      if (pendingScroll.current) {
        const pending = pendingScroll.current;
        pendingScroll.current = undefined;
        applyNavigationScroll(options.navigationScroll, {
          ...committed,
          kind: pending.navigation,
          navigation: pending.navigation,
          position: pending.position,
        });
      }
      restoringScroll.current = false;
      announceNavigation(committed, options.navigationAccessibility);
    }, [
      committed,
      focusRegistration,
        options.navigation,
        options.navigationAccessibility,
        options.navigationScroll,
    ]);

    function setSubmissionState(key: string, state: MutationNavigationState) {
      submissionStates.current.set(key, state);
      setSubmissionVersion((value) => value + 1);
    }

    function releaseMutationNavigation(form: HTMLFormElement, submissionKey?: string) {
      const key = mutationSubmissionKey(form, submissionKey);
      const state = submissionStates.current.get(key);
      if (state?.form !== form) return;
      if (state.state === "loading" && state.result) return;
      submissionControllers.current.get(key)?.abort();
      submissionControllers.current.delete(key);
      submissionStates.current.delete(key);
      setSubmissionVersion((value) => value + 1);
    }

    const router = useMemo(
      () => ({
        navigation: options.navigation ?? "server",
        locale,
        locales: options.locales,
        submissionVersion,
        getMutationNavigation(form?: HTMLFormElement, submissionKey?: string) {
          const key = mutationSubmissionKey(form, submissionKey);
          return submissionStates.current.get(key) ?? {
            state: "idle",
            form,
            submissionKey,
          };
        },
        releaseMutationNavigation,
        push(to: string) {
          abortSubmissions();
          restoringScroll.current = false;
          const previous = getCurrentLocation();
          navigationKind.current = "push";
          if (options.navigation !== "document") {
            saveCurrentScrollPosition();
          }
          const entry = createHistoryEntry();
          window.history.pushState(entry.state, "", to);
          activeHistoryEntry.current = entry.key;
          const next = getCurrentLocation();
          if (previous.pathname !== next.pathname || previous.search !== next.search) {
            supersedeRouteLoad();
            routeLoadCause.current = "navigation";
          }
          lastLocation.current = next;
          setLocation(next);

          if (
            previous.pathname === next.pathname &&
            previous.search === next.search &&
            previous.hash !== next.hash
          ) {
            scrollToHash(next.hash);
          }
        },
        replace(to: string) {
          abortSubmissions();
          restoringScroll.current = false;
          const previous = getCurrentLocation();
          navigationKind.current = "replace";
          if (options.navigation !== "document") {
            saveCurrentScrollPosition();
          }
          window.history.replaceState(
            withHistoryEntry(window.history.state, activeHistoryEntry.current),
            "",
            to,
          );
          const next = getCurrentLocation();
          if (previous.pathname !== next.pathname || previous.search !== next.search) {
            supersedeRouteLoad();
            routeLoadCause.current = "navigation";
          }
          lastLocation.current = next;
          setLocation(next);

          if (
            options.navigation !== "document" &&
            previous.pathname === next.pathname &&
            previous.search === next.search &&
            previous.hash !== next.hash
          ) {
            scrollToHash(next.hash);
          }
        },
        async submitMutation(form: HTMLFormElement, submitter: HTMLElement | null, submissionKey?: string) {
          if ((options.navigation ?? "server") !== "server") return;
          const request = createMutationRequest(form, submitter);
          if (!request) return;
          const key = mutationSubmissionKey(form, submissionKey);
          submissionControllers.current.get(key)?.abort();
          const controller = new AbortController();
          submissionControllers.current.set(key, controller);
          const formData = request.formData;
          const isCurrent = () =>
            !controller.signal.aborted && submissionControllers.current.get(key) === controller;
          setSubmissionState(key, {
            state: "submitting",
            form,
            submissionKey,
            formData,
          });
          let response: Response | undefined;
          try {
            const mutation = await performMutationRequest({
              body: request.body,
              contentType: request.contentType,
              method: request.method,
              signal: controller.signal,
              url: request.url,
            });
            response = mutation.response;
            if (!isCurrent()) return;
            const result = mutation.result;
            if (!isCurrent()) return;
            if (result?.status === "invalid") {
              setSubmissionState(key, { state: "invalid", form, submissionKey, formData, result });
              return;
            }
            if (result?.status === "redirect") {
              const destination = validateMutationRedirect(result.location);
              if (!destination) {
                setSubmissionState(key, { state: "error", form, submissionKey, formData, response });
                return;
              }
              supersedeRouteLoad();
              abortSubmissions(controller);
              routeLoadCause.current = "navigation";
              setSubmissionState(key, { state: "loading", form, submissionKey, formData });
              saveCurrentScrollPosition();
              if (result.history === "replace") {
                window.history.replaceState(
                  withHistoryEntry(null, activeHistoryEntry.current),
                  "",
                  destination,
                );
              } else {
                const entry = createHistoryEntry();
                window.history.pushState(entry.state, "", destination);
                activeHistoryEntry.current = entry.key;
              }
              navigationKind.current = result.history;
              lastLocation.current = getCurrentLocation();
              setLocation(lastLocation.current);
              setRouteRefresh((value) => value + 1);
              return;
            }
            if (result?.status === "failed" || !response.ok) {
              setSubmissionState(key, { state: "error", form, submissionKey, formData, response });
              return;
            }
            if (result?.status === "success" && result.revalidate) {
              setSubmissionState(key, { state: "loading", form, submissionKey, formData, result });
              supersedeRouteLoad();
              routeLoadCause.current = "refresh";
              setRouteRefresh((value) => value + 1);
            } else {
              setSubmissionState(key, { state: "idle", form, submissionKey, result });
            }
          } catch {
            if (isCurrent()) {
              setSubmissionState(key, { state: "error", form, submissionKey, formData, response });
            }
          } finally {
            if (submissionControllers.current.get(key) === controller) {
              submissionControllers.current.delete(key);
            }
          }
        },
      }),
      [submissionVersion],
    );

    useLayoutEffect(() => registerMutationRouter({
      redirect(destination, history, controller) {
        supersedeRouteLoad();
        abortSubmissions(controller);
        routeLoadCause.current = "navigation";
        saveCurrentScrollPosition();
        if (history === "replace") {
          window.history.replaceState(
            withHistoryEntry(null, activeHistoryEntry.current),
            "",
            destination,
          );
        } else {
          const entry = createHistoryEntry();
          window.history.pushState(entry.state, "", destination);
          activeHistoryEntry.current = entry.key;
        }
        navigationKind.current = history;
        lastLocation.current = getCurrentLocation();
        setLocation(lastLocation.current);
        setRouteRefresh((value) => value + 1);
      },
      refresh() {
        return new Promise<void>((resolve) => {
          supersedeRouteLoad();
          routeLoadCause.current = "refresh";
          routeRefreshWaiters.current.add(resolve);
          setRouteRefresh((value) => value + 1);
        });
      },
    }), [locale, options.locales, options.navigation]);

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
          resolvedRouteVersion,
          onCommitted: (value) => {
            if (pendingCommitRef.current === value) setCommitted(value);
          },
          onRenderError: () => {
            setCommitted(pendingCommit
              ? { ...pendingCommit, outcome: "error", title: "Navigation failed" }
              : null);
            settleRouteRefreshes();
          },
          onRouteCommitted: settleRouteRefreshes,
        }),
      }),
    });

    function settleRouteRefreshes() {
      for (const resolve of routeRefreshWaiters.current) resolve();
      routeRefreshWaiters.current.clear();
      for (const [key, state] of submissionStates.current) {
        if (state.state === "loading") {
          submissionStates.current.set(key, {
            state: "idle",
            form: state.form,
            submissionKey: state.submissionKey,
            result: state.result,
          });
        }
      }
      setSubmissionVersion((value) => value + 1);
    }
  };
}

// Hydration is safe only when the client reproduces the server output. The
// client replaces a page document when its route no longer matches. The client
// hydrates a document that the server marked as a 404. This operation preserves
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
    applicationPathname(window.location.pathname, options.locales),
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
        locale: initialData?.locale ?? options.locale,
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
    replace?: boolean;
    locale?: AppLocale;
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
    locale: _locale,
    onClick,
    path: _path,
    reloadDocument,
    replace,
    search: _search,
    target,
    to: _to,
    ...anchorProps
  } = props;
  // TYPE-EVIDENCE: href reads only the typed destination fields from LinkProps.
  const baseHref = href(props as LinkTarget<TTo>);
  const explicitLocale = _locale;
  const to = router.locales && (explicitLocale ?? router.locale)
    ? localizeHref(baseHref, (explicitLocale ?? router.locale)!, router.locales, window.location.href)
    : baseHref;

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
          if (replace) {
            router.replace(to);
          } else {
            router.push(to);
          }
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

const MutationFormContext = createContext<string | undefined>(undefined);

export function Form(props: FormProps) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const generatedKey = useId();
  const formKey = props.submissionKey ?? generatedKey;
  const formRef = useRef<HTMLFormElement | null>(null);
  const hydrated = useHydratedFormAction();
  // TYPE-EVIDENCE: FormProps permits a function action only for a branded MutationFormAction.
  const progressiveAction = typeof props.action === "function"
    ? props.action as MutationFormAction
    : undefined;
  const progressiveDetails = progressiveAction
    ? mutationFormActionDetails(progressiveAction)
    : undefined;
  const enhanceProgressiveAction = Boolean(
    progressiveAction && hydrated && router.navigation === "server",
  );

  useLayoutEffect(() => () => {
    if (formRef.current) {
      routerRef.current.releaseMutationNavigation(formRef.current, formKey);
    }
  }, [formKey]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    // TYPE-EVIDENCE: React form props expose the same submit event handler shape at runtime.
    const applicationHandler = props.onSubmit as
      | ((value: FormEvent<HTMLFormElement>) => void)
      | undefined;
    applicationHandler?.(event);
    if (progressiveAction) return;
    if (event.defaultPrevented || router.navigation !== "server") return;
    // TYPE-EVIDENCE: React forwards the browser SubmitEvent as nativeEvent for form submissions.
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (!canInterceptMutation(event.currentTarget, submitter)) return;
    event.preventDefault();
    void router.submitMutation(
      event.currentTarget,
      submitter,
      formKey,
    );
  }

  const { submissionKey: _submissionKey, ...formProps } = props;
  const action = progressiveAction
    ? enhanceProgressiveAction ? progressiveAction : progressiveDetails?.url
    : formProps.action;
  return createElement(
    MutationFormContext.Provider,
    {
      value: formKey,
      children: createElement("form", {
        ...formProps,
        action,
        ...(progressiveAction
          ? {
              encType: enhanceProgressiveAction ? undefined : formProps.encType,
              method: enhanceProgressiveAction ? undefined : "post",
              onSubmit: formProps.onSubmit,
            }
          : { onSubmit }),
        ref: (element: HTMLFormElement | null) => {
          formRef.current = element;
        },
      }),
    },
  );
}

export function MutationSubmit(props: MutationSubmitProps) {
  const router = useRouter();
  const hydrated = useHydratedFormAction();
  const details = mutationFormActionDetails(props.formAction);
  const enhance = hydrated && router.navigation === "server";
  return createElement("button", {
    ...props,
    formAction: enhance ? props.formAction : details.url,
    formMethod: enhance ? undefined : "post",
  });
}

function useHydratedFormAction() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

export function useNavigation<TData = unknown, TField extends string = string>(options?: {
  form?: HTMLFormElement;
  submissionKey?: string;
}): MutationNavigationState<TData, TField> {
  const contextKey = useContext(MutationFormContext);
  // TYPE-EVIDENCE: the router stores MutationNavigationState values and the generic only describes its application data.
  return useRouter().getMutationNavigation(options?.form, options?.submissionKey ?? contextKey) as MutationNavigationState<TData, TField>;
}

export function useFormNavigation<TData = unknown, TField extends string = string>(submissionKey?: string) {
  return useNavigation<TData, TField>({ submissionKey });
}

function RouteRenderer({
  Loading,
  NotFound,
  match,
  onRenderError,
  onCommitted,
  pendingCommit,
  resolvedRouteVersion,
  onRouteCommitted,
}: {
  Loading?: ComponentType;
  NotFound?: ComponentType<{ pathname: string }>;
  match: PendingRouteMatch;
  onCommitted: (value: NavigationCommit) => void;
  onRenderError: () => void;
  pendingCommit: NavigationCommit | null;
  resolvedRouteVersion: number;
  onRouteCommitted: () => void;
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
    ), createElement(NavigationCommitMarker, { commit: pendingCommit, onCommit: onCommitted, onRouteCommitted, resolvedRouteVersion }));
  }

  if (match.status === "error") {
    return createElement(Fragment, null, match.Error
      ? createElement(match.Error, {
          error: match.error,
          pathname: match.pathname,
          status: errorStatus(match.error),
        })
      : null, createElement(NavigationCommitMarker, { commit: pendingCommit, onCommit: onCommitted, onRouteCommitted, resolvedRouteVersion }));
  }

  const { data, error, page, layouts, path, pathname } = match.match;
  const pageElement = createElement(page, { data, path, pathname });
  const routeElement = layouts.reduceRight<ReactNode>(
    (children, Layout) => createElement(Layout, { path, pathname, children }),
    pageElement,
  );

  return createElement(RouteErrorBoundary, {
    Error: error,
      children: createElement(Fragment, null, routeElement, createElement(NavigationCommitMarker, { commit: pendingCommit, onCommit: onCommitted, onRouteCommitted, resolvedRouteVersion })),
    onError: onRenderError,
    pathname,
  });
}

function NavigationCommitMarker({
  commit,
  onCommit,
  onRouteCommitted,
  resolvedRouteVersion,
}: {
  commit: NavigationCommit | null;
  onCommit: (value: NavigationCommit) => void;
  onRouteCommitted: () => void;
  resolvedRouteVersion: number;
}) {
  const signaled = useRef<NavigationCommit | null>(null);
  const signaledRouteVersion = useRef(0);
  useLayoutEffect(() => {
    if (resolvedRouteVersion > signaledRouteVersion.current) {
      signaledRouteVersion.current = resolvedRouteVersion;
      onRouteCommitted();
    }
    if (commit && signaled.current !== commit) {
      signaled.current = commit;
      onCommit(commit);
    }
  }, [commit, onCommit, onRouteCommitted, resolvedRouteVersion]);
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

type PendingScroll = {
  navigation: NavigationCommit["kind"];
  position?: ScrollPosition;
};

type ScrollPosition = { x: number; y: number };

const SCROLL_STATE_KEY = "__demiurge_scroll";
const HISTORY_ENTRY_STATE_KEY = "__demiurge_history_entry";
let nextHistoryEntry = 0;

function ensureHistoryEntry() {
  const existing = readHistoryEntry(window.history.state);
  if (existing) return existing;
  const entry = createHistoryEntry(window.history.state);
  window.history.replaceState(entry.state, "", window.location.href);
  return entry.key;
}

function createHistoryEntry(state?: unknown) {
  const key = `entry:${++nextHistoryEntry}`;
  return { key, state: withHistoryEntry(state, key) };
}

function withHistoryEntry(state: unknown, key = `entry:${++nextHistoryEntry}`) {
  return state && typeof state === "object"
    ? { ...state, [HISTORY_ENTRY_STATE_KEY]: key }
    : { [HISTORY_ENTRY_STATE_KEY]: key };
}

function readHistoryEntry(state: unknown) {
  if (!state || typeof state !== "object") return undefined;
  const key = Reflect.get(state, HISTORY_ENTRY_STATE_KEY);
  return typeof key === "string" ? key : undefined;
}

function currentScrollPosition(): ScrollPosition {
  return { x: window.scrollX, y: window.scrollY };
}

function rememberScrollPosition(
  activeEntry?: string,
  position = currentScrollPosition(),
) {
  const state = window.history.state;
  if (activeEntry && readHistoryEntry(state) !== activeEntry) return;
  const nextState = state && typeof state === "object"
    ? { ...state, [SCROLL_STATE_KEY]: position }
    : { [SCROLL_STATE_KEY]: position };

  try {
    window.history.replaceState(nextState, "", window.location.href);
  } catch {
    // A history implementation can reject state writes. Navigation remains safe.
  }
}

function readScrollPosition() {
  const value = window.history.state?.[SCROLL_STATE_KEY];
  return value && typeof value === "object" &&
      typeof value.x === "number" && typeof value.y === "number"
    ? { x: value.x, y: value.y }
    : undefined;
}

function applyNavigationScroll(
  option: NavigationScrollOption | undefined,
  context: NavigationScrollContext,
) {
  if (context.kind === "pop" && context.url.hash) {
    return;
  }

  if (option === false) {
    return;
  }

  if (typeof option === "function") {
    try {
      option(context);
    } catch {
      // An application scroll callback cannot break route rendering.
    }
    return;
  }

  const x = context.kind === "pop" ? context.position?.x ?? 0 : 0;
  const y = context.kind === "pop" ? context.position?.y ?? 0 : 0;
  window.scrollTo?.(x, y);
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
  } catch (error) {
    if (error instanceof Error && error.message.includes("malformed versioned")) throw error;
    return undefined;
  }
}

function mutationSubmissionKey(form: HTMLFormElement | undefined, submissionKey?: string) {
  if (submissionKey) return submissionKey;
  if (!form) return "default";
  let id = formIds.get(form);
  if (!id) {
    id = `form:${nextFormId++}`;
    formIds.set(form, id);
  }
  return id;
}

const formIds = new WeakMap<HTMLFormElement, string>();
let nextFormId = 1;

function canInterceptMutation(form: HTMLFormElement, submitter: HTMLElement | null) {
  const options = formSubmissionOptions(form, submitter);
  if (!options) return false;
  const { action, enctype, method, target } = options;
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return false;
  if (target && target.toLowerCase() !== "_self") return false;
  try {
    const url = new URL(action, window.location.href);
    if (url.origin !== window.location.origin) return false;
  } catch {
    return false;
  }
  return ["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"].includes(enctype);
}

function createMutationRequest(form: HTMLFormElement, submitter: HTMLElement | null) {
  if (!canInterceptMutation(form, submitter)) return undefined;
  const { action, enctype, method } = formSubmissionOptions(form, submitter)!;
  const formData = submitter
    ? new FormData(form, submitter)
    : new FormData(form);
  if (enctype === "multipart/form-data") {
    return { body: formData, contentType: undefined, formData, method, url: action };
  }
  if (enctype === "application/x-www-form-urlencoded") {
    const body = new URLSearchParams();
    for (const [name, value] of formData) {
      if (typeof value === "string") body.append(name, value);
      else body.append(name, value.name);
    }
    return {
      body,
      contentType: "application/x-www-form-urlencoded;charset=UTF-8",
      formData,
      method,
      url: action,
    };
  }
  const lines: string[] = [];
  for (const [name, value] of formData) {
    lines.push(`${name}=${typeof value === "string" ? value : value.name}`);
  }
  return {
    body: `${lines.join("\r\n")}\r\n`,
    contentType: "text/plain;charset=UTF-8",
    formData,
    method,
    url: action,
  };
}

function formSubmissionOptions(form: HTMLFormElement, submitter: HTMLElement | null) {
  if (!isSupportedMutationSubmitter(submitter)) return undefined;
  const button = submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement
    ? submitter
    : undefined;
  return {
    action: (submitterFormAttribute(button, "formaction") ?? form.action) || window.location.href,
    enctype: ((submitterFormAttribute(button, "formenctype") ?? form.enctype) || "application/x-www-form-urlencoded").toLowerCase(),
    method: ((submitterFormAttribute(button, "formmethod") ?? form.method) || "get").toUpperCase(),
    target: submitterFormAttribute(button, "formtarget") ?? form.target,
  };
}

function submitterFormAttribute(
  submitter: HTMLButtonElement | HTMLInputElement | undefined,
  name: "formaction" | "formenctype" | "formmethod" | "formtarget",
) {
  return submitter?.hasAttribute(name) ? submitter.getAttribute(name) ?? "" : undefined;
}

function isSupportedMutationSubmitter(submitter: HTMLElement | null) {
  if (!submitter) return true;
  if (submitter instanceof HTMLButtonElement) {
    return !submitter.disabled && submitter.type === "submit";
  }
  return submitter instanceof HTMLInputElement &&
    !submitter.disabled && submitter.type === "submit";
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
  locale?: string;
  locales?: LocaleConfiguration;
  navigation: "document" | "server";
  submissionVersion: number;
  push(to: string): void;
  getMutationNavigation(form?: HTMLFormElement, submissionKey?: string): MutationNavigationState;
  releaseMutationNavigation(form: HTMLFormElement, submissionKey?: string): void;
  submitMutation(form: HTMLFormElement, submitter: HTMLElement | null, submissionKey?: string): Promise<void>;
  replace(to: string): void;
};

const RouterContext = createContext<RouterApi>({
  navigation: "document",
  submissionVersion: 0,
  push(to) {
    window.location.href = to;
  },
  getMutationNavigation() {
    return { state: "idle" };
  },
  releaseMutationNavigation() {},
  async submitMutation(form) {
    form.submit();
  },
  replace(to) {
    window.location.replace(to);
  },
});

function useRouter() {
  return useContext(RouterContext);
}
