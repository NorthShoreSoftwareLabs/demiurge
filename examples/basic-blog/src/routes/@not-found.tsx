import type { NotFoundProps } from "@demiurge-js/core";

export default function NotFound({ pathname }: NotFoundProps) {
  return (
    <article>
      <p className="eyebrow">Not found</p>
      <h1>No page at {pathname}</h1>
      <p>The app owns this fallback through its route tree.</p>
    </article>
  );
}
