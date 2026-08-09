import { Link, page, type RouteProps } from "demiurge";

export const GET = page({
  data: () => ({ renderedBy: "node", message: "SSR is running" }),
  view: HomePage,
});

function HomePage({ data }: RouteProps<"/", { renderedBy: string; message: string }>) {
  return (
    <main>
      <p>Production Node adapter</p>
      <h1>{data.message}</h1>
      <p data-rendered-by={data.renderedBy}>Rendered by {data.renderedBy}.</p>
      <Link to="/items">Browse items</Link>
    </main>
  );
}
