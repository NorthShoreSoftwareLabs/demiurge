import { Link, page, type RouteProps } from "../mini-framework/router";

export const GET = page({
  view: HomePage,
});

function HomePage(_props: RouteProps) {
  return (
    <main className="page-shell">
      <section className="intro">
        <p className="eyebrow">MVP 0.0.1</p>
        <h1>Route files own addresses, not pages.</h1>
        <p>
          This app discovers route files, turns filenames into URL patterns,
          loads the matched <code>GET</code> capability, and renders page
          results without a full page reload.
        </p>
      </section>

      <section className="panel">
        <h2>Routes are files</h2>
        <ul>
          <li>
            <code>src/routes/index.tsx</code> becomes <code>/</code>
          </li>
          <li>
            <code>src/routes/blog/index.tsx</code> becomes <code>/blog</code>
          </li>
          <li>
            <code>src/routes/blog/[slug].tsx</code> becomes{" "}
            <code>/blog/:slug</code>
          </li>
          <li>
            <code>src/routes/@layout.tsx</code> wraps every page
          </li>
          <li>
            Route files export <code>GET = page(...)</code>
          </li>
        </ul>
      </section>

      <Link className="button" to="/blog">
        Open blog routes
      </Link>
    </main>
  );
}
