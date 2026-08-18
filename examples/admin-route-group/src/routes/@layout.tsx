import { Link, type LayoutProps } from "@demiurgejs/core";

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div className="shell">
      <header>
        <Link to="/">Admin route group</Link>
        <nav>
          <Link to="/">Home</Link>
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/settings">Settings</Link>
          <Link to="/login">Log in</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
