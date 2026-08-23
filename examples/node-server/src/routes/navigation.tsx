import {
  defineLinks,
  defineMetadata,
  defineScripts,
  Link,
  page,
  preconnect,
  script,
  type RouteProps,
} from "@demiurgejs/core";
import { recordServerNavigationContribution } from "../server/navigation.server";

export const links = defineLinks(() => {
  recordServerNavigationContribution("Route links");
  return [preconnect("https://navigation.example.test")];
});

export const scripts = defineScripts(() => {
  recordServerNavigationContribution("Route scripts");
  return [script({ src: "/navigation-contribution.js" })];
});

export const metadata = defineMetadata({
  description: "Server-resolved browser navigation contributions.",
  title: "Navigation",
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
        data-navigation-kind="query"
        hash="results"
        search={{ q: ["alpha", "beta"] }}
        title="Load the repeated query"
        to="/navigation"
      >
        Repeated query
      </Link>
      <div id="results">Results</div>
    </main>
  );
}
