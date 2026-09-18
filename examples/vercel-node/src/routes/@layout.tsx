import { Link, type LayoutProps } from "@demiurgejs/core";
import "../styles.css";

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div className="app-shell">
      <header>
        <Link to="/">Vercel runtime</Link>
        <nav>
          <Link to="/">Home</Link>
          <Link to="/about">About</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
