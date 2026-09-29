import { page, type RouteProps } from "@demiurgejs/core";

export const GET = page({ render: { mode: "static" }, view: HomePage });

function HomePage(_props: RouteProps) {
  return <main><h1>Application test fixture</h1></main>;
}
