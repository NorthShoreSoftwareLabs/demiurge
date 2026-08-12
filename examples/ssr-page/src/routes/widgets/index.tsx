import { Link, defineMetadata, page, type RouteProps } from "@demiurge/core";

export const metadata = defineMetadata({
  description: "Every widget in the catalog, each linking to its own page.",
  title: "Widgets",
});

const WIDGET_IDS = ["north-star", "compass", "beacon"];

export const GET = page({
  view: WidgetsIndex,
});

function WidgetsIndex(_props: RouteProps) {
  return (
    <article>
      <p className="eyebrow">Index route</p>
      <h1>Widgets</h1>
      <p>
        Pick a widget below. Each link is a client-side navigation handled by{" "}
        <code>&lt;Link /&gt;</code> after hydration; watch the address bar
        change without a full page reload.
      </p>
      <ul>
        {WIDGET_IDS.map((id) => (
          <li key={id}>
            <Link to="/widgets/[id]" path={{ id }}>
              {id}
            </Link>
          </li>
        ))}
      </ul>
    </article>
  );
}
