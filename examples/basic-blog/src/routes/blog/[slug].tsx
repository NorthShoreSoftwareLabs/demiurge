import { defineMetadata, page, type RouteProps } from "@demiurgejs/core";

export const GET = page({
  view: BlogPost,
});
export const metadata = defineMetadata({
  openGraph: {
    image: "/blog-og.png",
  },
  title: "Blog post",
});

function BlogPost({ path }: RouteProps<"/blog/[slug]">) {
  return (
    <article>
      <p className="eyebrow">Dynamic route</p>
      <h1>{path.slug}</h1>
      <p>
        This page came from <code>routes/blog/[slug].tsx</code>. The router
        decoded the <code>[slug]</code> filename segment into{" "}
        <code>path.slug</code>.
      </p>
    </article>
  );
}
