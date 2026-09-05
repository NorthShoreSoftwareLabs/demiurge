import { defineMetadata, page, type RouteProps } from "@demiurgejs/core";

const guides = {
  deployment: {
    body: "Apply the headers in demiurge-static-manifest.json at your hosting layer, then publish dist.",
    title: "Deployment",
  },
  routing: {
    body: "Dynamic route entries come from the route's typed paths export and become concrete directories.",
    title: "Static routing",
  },
} as const;

type GuideSlug = keyof typeof guides;
type GuideData = (typeof guides)[GuideSlug];

export const paths = async () =>
  Object.keys(guides).map((slug) => ({ slug }));

export const metadata = defineMetadata({
  title: "Guide",
});

export const GET = page<"/guides/[slug]", GuideData>({
  publicData: true,
  // TYPE-EVIDENCE: The paths export returns only keys of guides, so the slug is a GuideSlug.
  data: async ({ path }) => guides[path.slug as GuideSlug],
  render: { mode: "static" },
  view: Guide,
});

function Guide({ data, path }: RouteProps<"/guides/[slug]", GuideData>) {
  return (
    <main>
      <p className="eyebrow">Guide / {path.slug}</p>
      <h1>{data.title}</h1>
      <p>{data.body}</p>
    </main>
  );
}
