import {
  Link,
  defineMetadata,
  structuredData,
  type LayoutProps,
} from "@demiurgejs/core";

export const metadata = defineMetadata({
  canonical: "/",
  description: "Notes about secure, typed web applications.",
  structuredData: [structuredData({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Demiurge Metadata Blog",
  })],
  title: {
    default: "Metadata Blog",
    format: (title) => `${title} | Metadata Blog`,
  },
});

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div className="shell">
      <header>
        <Link className="brand" to="/">Metadata Blog</Link>
        <nav>
          <Link to="/">Home</Link>
          <Link to="/posts/secure-routing">Post</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
