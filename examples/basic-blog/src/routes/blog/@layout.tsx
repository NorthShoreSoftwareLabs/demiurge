import type { LayoutProps } from "@demiurge-js/core";

export default function BlogLayout({ children }: LayoutProps) {
  return (
    <main className="page-shell blog-shell">
      <aside className="sidebar">
        <p className="eyebrow">Nested layout</p>
        <h2>Blog</h2>
        <p>
          This sidebar comes from <code>routes/blog/@layout.tsx</code>, so it
          wraps every route under <code>/blog</code>.
        </p>
      </aside>
      <section className="content">{children}</section>
    </main>
  );
}
