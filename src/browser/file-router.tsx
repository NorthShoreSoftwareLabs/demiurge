import {
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
  loadRoute,
  type PendingRouteMatch,
} from "../router";

type FileRouterOptions = {
  routes: Record<string, RouteImporter>;
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
      loadRoute(manifest, location.pathname).then((nextMatch) => {
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

function RouteRenderer({ match }: { match: PendingRouteMatch }) {
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
