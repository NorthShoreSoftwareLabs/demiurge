import { Link, type LayoutProps } from "@demiurgejs/core";

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div className="shell">
      <header>
        <Link to="/">Nested policies</Link>
        <nav>
          <Link to="/">Home</Link>
          <Link to="/admin">Admin</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
