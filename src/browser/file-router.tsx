import {
  ComponentType,
  MouseEvent,
  ReactNode,
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { RouteImporter } from "../route";
import {
  createRouteManifest,
  loadPageRoute,
  type PendingRouteMatch,
} from "../router";
import { href, type AppHref, type LinkTarget, type LinkTo } from "../routing";

type FileRouterOptions = {
  routes: Record<string, RouteImporter>;
  loading?: ComponentType;
  notFound?: ComponentType<{
    pathname: string;
  }>;
};

export function createFileRouter(options: FileRouterOptions) {
  const manifest = createRouteManifest(options.routes);

  return function FileRouter() {
    const [location, setLocation] = useState(() => getCurrentLocation());
    const [match, setMatch] = useState<PendingRouteMatch>({
      status: "loading",
    });

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
      loadPageRoute(manifest, location.pathname).then((nextMatch) => {
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
      children: createElement(RouteRenderer, {
        Loading: options.loading,
        NotFound: options.notFound,
        match,
      }),
    });
  };
}

export function Link<const TTo extends AppHref>(props: LinkTo<TTo> & {
  children: ReactNode;
  className?: string;
}) {
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
    return Loading ? createElement(Loading) : null;
  }

  if (match.status === "not-found") {
    return NotFound ? createElement(NotFound, { pathname: match.pathname }) : null;
  }

  const { page, layouts, path, pathname } = match.match;
  const pageElement = createElement(page, { path, pathname });

  return layouts.reduceRight(
    (children, Layout) => createElement(Layout, { path, pathname, children }),
    pageElement,
  );
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
