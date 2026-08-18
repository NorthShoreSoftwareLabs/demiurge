import type { LayoutProps } from "@demiurgejs/core";

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div className="shell">
      <header>Demiurge webhook security example</header>
      {children}
    </div>
  );
}
