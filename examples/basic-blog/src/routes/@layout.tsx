import {
  Link,
  defineMetadata,
  defineScripts,
  script,
  type LayoutProps,
} from "demiurge";

export const metadata = defineMetadata({
  description: "A small Demiurge blog example.",
  title: {
    default: "Demiurge Basic Blog",
    format: (title) => `${title} | Demiurge Basic Blog`,
  },
});
export const scripts = defineScripts([
  script({
    src: "/basic-blog-shell.js",
    strategy: "afterInteractive",
  }),
]);

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div>
      <header className="site-header">
        <Link className="brand" to="/">
          Demiurge
        </Link>
        <nav>
          <Link to="/">Home</Link>
          <Link to="/blog">Blog</Link>
          <Link to="/blog/[slug]" path={{ slug: "file-based-routing" }}>
            Dynamic route
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
