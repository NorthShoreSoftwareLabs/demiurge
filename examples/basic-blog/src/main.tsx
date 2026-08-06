import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createFileRouter } from "demiurge";
import type { RouteModule } from "demiurge";
import "./styles.css";

const routes = import.meta.glob<RouteModule>("./routes/**/*.tsx");
const Router = createFileRouter({
  loading: LoadingRoute,
  notFound: NotFoundRoute,
  routes,
});

function LoadingRoute() {
  return <main className="page-shell">Loading...</main>;
}

function NotFoundRoute({ pathname }: { pathname: string }) {
  return (
    <main className="page-shell">
      <h1>Not found</h1>
      <p>No route matched {pathname}.</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Router />
  </StrictMode>,
);
