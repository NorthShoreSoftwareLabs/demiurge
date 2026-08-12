import { Link, defineMetadata, page, type RouteProps } from "@demiurgejs/core";

export const metadata = defineMetadata({
  description: "A single widget, addressed by its path variable.",
  title: "Widget detail",
});

export const GET = page({
  view: WidgetDetail,
});

function WidgetDetail({ path }: RouteProps<"/widgets/[id]">) {
  return (
    <article>
      <p className="eyebrow">Dynamic route</p>
      <h1>{path.id}</h1>
      <p>
        This page is <code>routes/widgets/[id].tsx</code>. The router decodes
        the <code>[id]</code> filename segment into <code>path.id</code>, not{" "}
        <code>params.id</code>. Demiurge uses <code>path</code> everywhere a
        route reads its own address.
      </p>
      <Link className="button" to="/widgets">
        Back to widgets
      </Link>
    </article>
  );
}
