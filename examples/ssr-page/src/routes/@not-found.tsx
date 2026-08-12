import { Link, type NotFoundProps } from "@demiurge/core";

export default function NotFound({ pathname }: NotFoundProps) {
  return (
    <article>
      <p className="eyebrow">Not found</p>
      <h1>No page at {pathname}</h1>
      <Link className="button" to="/">
        Back home
      </Link>
    </article>
  );
}
