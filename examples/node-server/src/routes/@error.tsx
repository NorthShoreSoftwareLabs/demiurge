import { Link, type RouteErrorProps } from "@demiurge-js/core";

// Production renders this for a failure inside a page render. It never
// receives anything it could leak: the message and stack stay on the server,
// and dev shows its own document with both instead of this one.
export default function RouteError({ pathname, status }: RouteErrorProps) {
  return (
    <main>
      <p>{status}</p>
      <h1>Something went wrong at {pathname}</h1>
      <Link to="/">Back home</Link>
    </main>
  );
}
