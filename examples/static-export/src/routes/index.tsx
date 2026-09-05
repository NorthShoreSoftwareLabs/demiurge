import {
  Image,
  Link,
  defineMetadata,
  page,
  structuredData,
  type RouteProps,
} from "@demiurgejs/core";
import { images } from "../images";
import { siteStructuredData } from "../site-structured-data";

type HomeData = {
  output: string[];
};

export const metadata = defineMetadata({
  structuredData: [structuredData(siteStructuredData)],
  title: "Production static output",
});

export const GET = page<string, HomeData>({
  publicData: true,
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
      <Image
        alt="A layered mountain skyline at dusk"
        className="hero"
        format="webp"
        height={300}
        policy={images}
        priority
        quality={72}
        sizes="(min-width: 720px) 600px, 100vw"
        src="/hero.png"
        width={600}
        widths={[600, 1200]}
      />

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
