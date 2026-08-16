import {
  Link,
  defineMetadata,
  page,
  structuredData,
  type RouteProps,
} from "@demiurgejs/core";

const post = {
  description: "How typed routes keep application addresses auditable.",
  title: "Secure routing with typed addresses",
};

export const paths = () => [{ slug: "secure-routing" }];

export const metadata = defineMetadata({
  canonical: "/posts/secure-routing",
  description: post.description,
  openGraph: {
    description: post.description,
    image: "/og/secure-routing/image.svg",
    title: post.title,
  },
  structuredData: [structuredData({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
  })],
  title: "Secure routing",
});

export const GET = page<"/posts/[slug]">({
  view: PostPage,
});

function PostPage({ path }: RouteProps<"/posts/[slug]">) {
  return (
    <main>
      <p className="eyebrow">Post / {path.slug}</p>
      <h1>{post.title}</h1>
      <p>{post.description}</p>
      <p>
        The route metadata adds an article entry and points Open Graph clients
        to the generated image route.
      </p>
      <Link className="button" to="/">Return home</Link>
    </main>
  );
}
