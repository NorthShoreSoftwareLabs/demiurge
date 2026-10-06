import { Link, type LayoutProps } from "@demiurgejs/core";
import "../styles.css";

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div className="shell">
      <header>
        <strong>Adversarial security fixture</strong>
        <nav>
          <Link to="/">Home</Link>
          <Link to="/secure/record">Private record</Link>
          <Link to="/redirects">Redirect checks</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
