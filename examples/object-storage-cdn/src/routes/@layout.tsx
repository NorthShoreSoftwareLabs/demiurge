import { Link, defineMetadata, type LayoutProps } from "@demiurgejs/core";

export const metadata = defineMetadata({
  description: "A static build deployed through an object-storage origin and a CDN.",
  title: {
    default: "Object Storage + CDN",
    format: (title) => `${title} | Object Storage + CDN`,
  },
});

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="shell">
      <header>
        <Link className="brand" to="/">Demiurge Static</Link>
        <nav aria-label="Primary navigation">
          <Link to="/">Home</Link>
          <Link to="/about">About</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
