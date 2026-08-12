import { Link, type RouteErrorProps } from "@demiurgejs/core";

// Production renders this for a failure inside a page render. The error message
// and stack stay on the server. Development shows a separate document that
// contains both items.
export default function RouteError({ pathname, status }: RouteErrorProps) {
  return (
    <main>
      <p>{status}</p>
      <h1>Something went wrong at {pathname}</h1>
      <Link to="/">Back home</Link>
    </main>
  );
}
