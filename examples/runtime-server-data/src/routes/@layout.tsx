import type { LayoutProps } from "@demiurge-js/core";
import "../styles.css";

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div className="app-shell">
      <header>
        <span>Demiurge</span>
        <strong>Runtime server data</strong>
      </header>
      {children}
    </div>
  );
}
