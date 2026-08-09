import {
  Link,
  defineMetadata,
  type LayoutProps,
} from "demiurge";

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
      {children}
    </div>
  );
}
