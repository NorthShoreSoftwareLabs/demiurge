import { Link, type NotFoundProps } from "demiurge";

export default function RootNotFound({ pathname }: NotFoundProps) {
  return (
    <main data-fallback-owner="root-not-found">
      <p className="status">404</p>
      <h1>No page at {pathname}</h1>
      <p>The root fallback owns paths outside a more specific section.</p>
      <Link to="/">Return home</Link>
    </main>
  );
}
