import { defineMetadata, page, type RouteProps } from "@demiurgejs/core";

export const metadata = defineMetadata({
  title: "Object storage + CDN deployment",
});

type HomeData = {
  message: string;
};

export const GET = page<string, HomeData>({
  data: () => ({
    // The integration probe sets this at build time to prove a redeploy
    // reaches the CDN and a rollback restores the previous release.
    message: process.env.RELEASE_MESSAGE ?? "Welcome to Demiurge.",
  }),
  render: { mode: "static" },
  view: Home,
});

function Home({ data }: RouteProps<string, HomeData>) {
  return (
    <main>
      <p className="eyebrow">Static adapter</p>
      <h1>Deployed to a content-addressed origin behind a CDN.</h1>
      <p data-testid="release-message">{data.message}</p>
      <p className="lede">
        <code>deploy/deploy.ts</code> uploads the content-hashed assets this
        page depends on before it publishes this page itself, so a client
        never requests a page that references an asset the origin has not
        received yet.
      </p>
    </main>
  );
}
