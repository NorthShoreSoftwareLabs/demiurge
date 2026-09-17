import { Link, type NotFoundProps } from "@demiurgejs/core";

export default function NotFound({ pathname }: NotFoundProps) {
  return (
    <main data-fallback-owner="vercel-example">
      <p>404</p>
      <h1>No route at {pathname}</h1>
      <Link to="/">Return home</Link>
    </main>
  );
}
