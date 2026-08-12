import { Link, defineMetadata, page, type RouteProps } from "@demiurgejs/core";

type HomeData = {
  output: string[];
};

export const metadata = defineMetadata({
  title: "Production static output",
});

export const GET = page<string, HomeData>({
  data: async () => ({
    output: [
      "Server-rendered HTML",
      "Hashed client assets",
      "Per-route deployment headers",
      "An app-owned 404 document",
    ],
  }),
  render: { mode: "static" },
  view: Home,
});

function Home({ data }: RouteProps<string, HomeData>) {
  return (
    <main>
      <p className="eyebrow">Static adapter</p>
      <h1>Built once, served without an application server.</h1>
      <p className="lede">
        Every page in this site was rendered through the production route
        pipeline and written beneath <code>dist/</code>.
      </p>
      <ul className="output-list">
        {data.output.map((item) => <li key={item}>{item}</li>)}
      </ul>
      <Link className="button" to="/guides/[slug]" path={{ slug: "deployment" }}>
        Read the deployment guide
      </Link>
    </main>
  );
}
