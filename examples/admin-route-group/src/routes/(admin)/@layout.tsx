import { Link, type LayoutProps } from "@demiurgejs/core";

// Both `/dashboard` and `/settings` share this shell, even though the
// `(admin)` directory that owns it contributes no URL segment of its own.
export default function AdminLayout({ children }: LayoutProps) {
  return (
    <div className="admin-shell">
      <nav>
        <Link to="/dashboard">Dashboard</Link>
        <Link to="/settings">Settings</Link>
      </nav>
      {children}
    </div>
  );
}
