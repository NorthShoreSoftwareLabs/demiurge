import type { LayoutProps } from "@demiurge-js/core";

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div className="site-shell">
      <header>Demiurge streaming example</header>
      {children}
    </div>
  );
}
