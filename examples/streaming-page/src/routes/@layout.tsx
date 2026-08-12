import type { LayoutProps } from "@demiurgejs/core";

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div className="site-shell">
      <header>Demiurge streaming example</header>
      {children}
    </div>
  );
}
