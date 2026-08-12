import { Link, page, type RouteProps } from "@demiurgejs/core";

type HomeData = {
  checksum: number;
  renderedAt: string;
};

export const GET = page({
  data: (): HomeData => {
    const renderedAt = new Date().toISOString();
    const checksum = Array.from(renderedAt).reduce(
      (total, character) => total + character.charCodeAt(0),
      0,
    );

    return { checksum, renderedAt };
  },
  view: HomePage,
});

function HomePage({ data }: RouteProps<"/", HomeData>) {
  return (
    <main className="page-shell">
      <section>
        <p className="eyebrow">Server-rendered, client-hydrated</p>
        <h1>This page was stamped by the server before you saw it.</h1>
        <p>
          The values below came from this route&apos;s <code>data</code>{" "}
          loader, which only ever runs on the server. The client reuses the
          result instead of calling the loader again during hydration.
        </p>

        <dl className="stamp">
          <dt>Rendered at</dt>
          <dd>{data.renderedAt}</dd>
          <dt>Checksum computed from that timestamp</dt>
          <dd>{data.checksum}</dd>
        </dl>

        <p>
          Reload the page (a full server request) and the timestamp and
          checksum change. Navigate here with <code>&lt;Link /&gt;</code> from
          another route in the running app and they stay put, because that is
          a client-side transition, not a new server render.
        </p>
      </section>

      <section className="panel">
        <h2>Where to look</h2>
        <ul>
          <li>
            <code>examples/ssr-page/src/routes/index.tsx</code> defines the{" "}
            <code>data</code> loader shown above.
          </li>
          <li>
            <code>examples/ssr-page/src/routes/widgets/index.tsx</code> lists
            widgets and links to a dynamic route.
          </li>
          <li>
            <code>examples/ssr-page/src/routes/widgets/[id].tsx</code> reads
            its <code>path.id</code> instead of a <code>params</code> object.
          </li>
          <li>
            <code>@layout.tsx</code> defines the metadata that cascades into
            the document head on every route.
          </li>
        </ul>
      </section>

      <Link className="button" to="/widgets">
        Browse widgets
      </Link>
    </main>
  );
}
