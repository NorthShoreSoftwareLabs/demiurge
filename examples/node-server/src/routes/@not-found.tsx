import { Link, defineMetadata, type NotFoundProps } from "@demiurge/core";

export const metadata = defineMetadata({
  title: "Not found",
});

// This renders inside the root layout, so a 404 keeps the header and nav.
// Add "export const layout = false" to opt out.
export default function NotFound({ pathname }: NotFoundProps) {
  return (
    <main>
      <p>404</p>
      <h1>No route at {pathname}</h1>
      <p>
        The server rendered this document and answered with a 404. An API
        client asking for JSON gets problem+json at the same path instead.
      </p>
      <Link to="/">Back home</Link>
    </main>
  );
}
