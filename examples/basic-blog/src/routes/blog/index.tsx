import { Link, page, type RouteProps } from "@demiurge-js/core";

export const GET = page({
  view: BlogIndex,
});

function BlogIndex(_props: RouteProps) {
  return (
    <article>
      <p className="eyebrow">Index route</p>
      <h1>Blog index</h1>
      <p>
        This page is rendered by <code>routes/blog/index.tsx</code>.
      </p>
      <Link
        className="button"
        to="/blog/[slug]"
        path={{ slug: "file-based-routing" }}
      >
        Read a dynamic route
      </Link>
    </article>
  );
}
