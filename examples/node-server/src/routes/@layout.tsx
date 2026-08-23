import {
  Link,
  RouteFocusBoundary,
  defineLinks,
  defineMetadata,
  fontLinks,
  type LayoutProps,
} from "@demiurgejs/core";
import { fonts } from "../fonts";

// The stylesheet and the preload both point at the self-hosted font handler.
export const links = defineLinks(fontLinks(fonts));

export const metadata = defineMetadata({
  description: "A production Node runtime example for Demiurge.",
  title: {
    default: "Demiurge Node Server",
    format: (title) => `${title} | Demiurge Node Server`,
  },
});

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div className="shell">
      <header>
        <Link to="/">Demiurge Node Server</Link>
        <nav>
          <Link to="/">Home</Link>
          <Link to="/items">Items</Link>
        </nav>
      </header>
      <RouteFocusBoundary as="div" data-route-focus-boundary="">{children}</RouteFocusBoundary>
    </div>
  );
}
