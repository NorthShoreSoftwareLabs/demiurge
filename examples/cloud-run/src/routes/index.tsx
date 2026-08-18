import { page, type RouteProps } from "@demiurgejs/core";

export const GET = page({
  data: () => ({
    renderedBy: "node",
    startedAt: new Date().toISOString(),
  }),
  view: HomePage,
});

function HomePage({
  data,
}: RouteProps<"/", { renderedBy: string; startedAt: string }>) {
  return (
    <main>
      <p>Production Node adapter, packaged for Cloud Run</p>
      <h1>Container is up</h1>
      <p data-rendered-by={data.renderedBy}>Rendered by {data.renderedBy}.</p>
      <p data-started-at={data.startedAt}>Process started at {data.startedAt}.</p>
      <p>
        <code>/.well-known/ready</code> reports the readiness state Cloud Run's
        startup probe can poll.
      </p>
    </main>
  );
}
