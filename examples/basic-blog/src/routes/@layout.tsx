import { Link, type LayoutProps } from "@demiurge/router";

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div>
      <header className="site-header">
        <Link className="brand" to="/">
          Demiurge
        </Link>
        <nav>
          <Link to="/">Home</Link>
          <Link to="/blog">Blog</Link>
          <Link to="/blog/file-based-routing">Dynamic route</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
