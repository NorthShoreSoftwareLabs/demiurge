import { page, type RouteProps } from "@demiurgejs/core";

export const GET = page({
  publicData: true,
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
      <p>Production Node adapter, packaged for VM and bare-metal deployment</p>
      <h1>Server is up</h1>
      <p data-rendered-by={data.renderedBy}>Rendered by {data.renderedBy}.</p>
      <p data-started-at={data.startedAt}>Process started at {data.startedAt}.</p>
      <p>
        <code>/.well-known/ready</code> reports the readiness state that can be
        polled by deployment monitoring.
      </p>
    </main>
  );
}
