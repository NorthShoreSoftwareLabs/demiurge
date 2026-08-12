import { Link, defineMetadata } from "@demiurge-js/core";

export const metadata = defineMetadata({ title: "Page not found" });

export default function NotFound() {
  return (
    <main>
      <p className="eyebrow">404</p>
      <h1>That page is not in this export.</h1>
      <p>The static adapter generated this fallback as <code>404.html</code>.</p>
      <Link className="button" to="/">Return home</Link>
    </main>
  );
}
