import { Link, defineMetadata } from "@demiurgejs/core";

export const metadata = defineMetadata({ title: "Page not found" });

export default function NotFound() {
  return (
    <main>
      <p className="eyebrow">404</p>
      <h1>That page is not in this release.</h1>
      <p>
        The CDN served this fallback from the object-storage origin's
        <code>404.html</code> object.
      </p>
      <Link className="button" to="/">Return home</Link>
    </main>
  );
}
