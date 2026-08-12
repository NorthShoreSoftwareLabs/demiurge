import { defineMetadata, page } from "@demiurgejs/core";

export const metadata = defineMetadata({ title: "About" });

export const GET = page({
  render: { mode: "static" },
  view: () => (
    <main>
      <p className="eyebrow">About</p>
      <h1>A real page, not a client-only shell.</h1>
      <p>
        View source to see the rendered route, layout, metadata, hydration data,
        stylesheet, and client entry already present in the artifact.
      </p>
    </main>
  ),
});
