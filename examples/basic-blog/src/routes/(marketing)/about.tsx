import { page } from "@demiurge-js/core";

export const GET = page(AboutPage);

function AboutPage() {
  return (
    <article>
      <p className="eyebrow">Route group</p>
      <h1>About Demiurge</h1>
      <p>This page is organized in a route group without changing its URL.</p>
    </article>
  );
}
