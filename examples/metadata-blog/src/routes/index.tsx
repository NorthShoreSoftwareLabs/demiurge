import { Link, defineMetadata, page } from "@demiurgejs/core";

export const metadata = defineMetadata({
  description: "A content site that uses the complete document metadata API.",
  title: "Home",
});

export const GET = page({
  view: () => (
    <main>
      <p className="eyebrow">Content site</p>
      <h1>Metadata belongs to the document pipeline.</h1>
      <p>
        This page combines inherited metadata, structured data, and generated
        search-engine resources.
      </p>
      <Link className="button" to="/posts/secure-routing">
        Read the post
      </Link>
    </main>
  ),
});
