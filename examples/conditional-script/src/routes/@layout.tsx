import { Link, type LayoutProps } from "@demiurgejs/core";

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div className="site-shell">
      <header>
        Demiurge conditional script example
        <nav>
          <Link to="/">Home</Link>
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/strategies">Strategies</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
