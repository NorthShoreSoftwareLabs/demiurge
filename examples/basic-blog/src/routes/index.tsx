import { Link, page, type RouteProps } from "@demiurge/core";

export const GET = page({
  view: HomePage,
});

function HomePage(_props: RouteProps) {
  return (
    <main className="page-shell">
      <section className="intro">
        <p className="eyebrow">MVP 0.0.1 fixture</p>
        <h1>Route files own addresses, not pages.</h1>
        <p>
          This fixture app exercises the framework router from outside the
          framework source tree.
        </p>
      </section>

      <section className="panel">
        <h2>Routes are files</h2>
        <ul>
          <li>
            <code>examples/basic-blog/src/routes/index.tsx</code> becomes{" "}
            <code>/</code>
          </li>
          <li>
            <code>examples/basic-blog/src/routes/blog/index.tsx</code> becomes{" "}
            <code>/blog</code>
          </li>
          <li>
            <code>examples/basic-blog/src/routes/blog/[slug].tsx</code> becomes{" "}
            <code>/blog/:slug</code>
          </li>
          <li>
            <code>@layout.tsx</code> files wrap page-compatible routes
          </li>
          <li>
            Route files export <code>GET = page(...)</code>
          </li>
          <li>
            API routes can export helpers like <code>GET = json(...)</code>
          </li>
        </ul>
      </section>

      <Link className="button" to="/blog">
        Open blog routes
      </Link>
    </main>
  );
}
