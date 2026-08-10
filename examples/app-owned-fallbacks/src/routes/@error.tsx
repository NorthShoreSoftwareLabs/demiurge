import { Link, type RouteErrorProps } from "demiurge";

export default function RootError({ pathname, status }: RouteErrorProps) {
  return (
    <main data-fallback-owner="root-error">
      <p className="status">{status}</p>
      <h1>The application could not render {pathname}</h1>
      <Link to="/">Return home</Link>
    </main>
  );
}
