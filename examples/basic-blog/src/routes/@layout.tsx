import {
  Link,
  defineLinks,
  defineMetadata,
  defineScripts,
  preconnect,
  preload,
  script,
  type LayoutProps,
} from "@demiurge-js/core";

export const links = defineLinks([
  preconnect("https://api.example.com"),
  preload("/basic-blog-shell.js", { as: "script" }),
]);
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
