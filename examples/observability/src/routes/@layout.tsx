import { WebVitals, type LayoutProps } from "@demiurgejs/core";
import { vitals } from "../web-vitals";

// One mount in the root layout covers every page. The component renders
// nothing and starts the browser collector after hydration.
export default function RootLayout({ children }: LayoutProps) {
  return (
    <div className="shell">
      <header>Demiurge observability example</header>
      {children}
      <WebVitals integration={vitals} />
    </div>
  );
}
