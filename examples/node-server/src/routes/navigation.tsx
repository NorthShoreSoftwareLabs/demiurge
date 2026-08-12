import {
  defineLinks,
  defineScripts,
  Link,
  page,
  type RouteProps,
} from "demiurge";
import { recordServerNavigationContribution } from "../server/navigation.server";

export const links = defineLinks(() => {
  recordServerNavigationContribution("Route links");
  return [];
});

export const scripts = defineScripts(() => {
  recordServerNavigationContribution("Route scripts");
  return [];
});

export const GET = page({
  data: ({ search }) => ({
    query: search.getAll("q"),
    server: recordServerNavigationContribution("Page data"),
  }),
  view: NavigationPage,
});

function NavigationPage({
  data,
}: RouteProps<"/navigation", { query: string[]; server: string }>) {
  return (
    <main>
      <h1>Navigation boundary</h1>
      <p data-query-values={data.query.join(",")}>
        Query: {data.query.length ? data.query.join(", ") : "none"}
      </p>
      <p>Loaded by the {data.server ? "server" : "browser"}.</p>
      <Link
        hash="results"
        search={{ q: ["alpha", "beta"] }}
        to="/navigation"
      >
        Repeated query
      </Link>
      <div id="results">Results</div>
    </main>
  );
}
