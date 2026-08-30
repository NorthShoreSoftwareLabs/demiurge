import { defineMetadata, page } from "@demiurgejs/core";

export const metadata = defineMetadata({ title: "About" });

export const GET = page({
  render: { mode: "static" },
  view: () => (
    <main>
      <p className="eyebrow">About</p>
      <h1>A mutable page, republished in place.</h1>
      <p>
        This page's object key never changes between releases. The CDN
        invalidates it on every deploy so a client never keeps stale content
        past a release.
      </p>
    </main>
  ),
});
