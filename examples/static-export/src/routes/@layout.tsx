import { Link, defineMetadata, type LayoutProps } from "@demiurgejs/core";

export const metadata = defineMetadata({
  description: "A production static export built with Demiurge.",
  title: {
    default: "Static Export",
    format: (title) => `${title} | Static Export`,
  },
});

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="shell">
      <header>
        <Link className="brand" to="/">Demiurge Static</Link>
        <nav aria-label="Primary navigation">
          <Link to="/">Home</Link>
          <Link to="/about">About</Link>
          <Link to="/guides/[slug]" path={{ slug: "deployment" }}>
            Deployment guide
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
