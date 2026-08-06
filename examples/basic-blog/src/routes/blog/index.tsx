import { Link, page, type RouteProps } from "demiurge";
import { routes } from "../../app-routes";

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
        to={routes.blog.post({ slug: "file-based-routing" })}
      >
        Read a dynamic route
      </Link>
    </article>
  );
}
