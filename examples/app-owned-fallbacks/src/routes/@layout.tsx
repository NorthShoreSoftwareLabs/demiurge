import { Link, type LayoutProps } from "demiurge";
import "../styles.css";

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div className="app-shell" data-layout-owner="root">
      <header>
        <Link to="/">Fallback Lab</Link>
        <nav>
          <Link to="/">Home</Link>
          <Link to="/projects">Projects</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
