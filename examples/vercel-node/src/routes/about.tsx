import {
  defineRoutePolicy,
  Link,
  page,
  security,
} from "@demiurgejs/core";

export const policy = defineRoutePolicy({
  document: security.static(),
});

export const GET = page({
  render: { mode: "static" },
  view: About,
});

function About() {
  return (
    <main>
      <h1>Prerendered application route</h1>
      <p>Vercel serves this document before the shared server handler.</p>
      <Link to="/">Return home</Link>
    </main>
  );
}
