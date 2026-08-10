import { Link, page, type RouteProps } from "demiurge";

let sharedDataLoads = 0;

export const GET = page({
  data: ({ cache }) => cache.get({
    fn: () => ({
      cacheLoad: ++sharedDataLoads,
      message: "SSR is running",
      renderedBy: "node",
    }),
    key: ["node-example", "home"],
    scope: "public",
  }),
  view: HomePage,
});

function HomePage({
  data,
}: RouteProps<
  "/",
  { cacheLoad: number; renderedBy: string; message: string }
>) {
  return (
    <main>
      <p>Production Node adapter</p>
      <h1>{data.message}</h1>
      <p data-rendered-by={data.renderedBy}>Rendered by {data.renderedBy}.</p>
      <p data-cache-load={data.cacheLoad}>
        Shared data load {data.cacheLoad}.
      </p>
      <Link to="/items">Browse items</Link>
    </main>
  );
}
