import {
  Link,
  defineLinks,
  defineMetadata,
  meta,
  preconnect,
  type LayoutProps,
} from "@demiurgejs/core";

export const links = defineLinks([preconnect("https://api.example.com")]);

export const metadata = defineMetadata({
  custom: [meta({ content: "Demiurge SSR Page", name: "application-name" })],
  description:
    "A minimal Demiurge example that renders on the server and hydrates on the client.",
  openGraph: {
    image: "/ssr-page-og.png",
  },
  title: {
    default: "Demiurge SSR Page",
    format: (title) => `${title} | Demiurge SSR Page`,
  },
});

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div data-development-mode={String(import.meta.env.DEV)}>
      <header className="site-header">
        <Link className="brand" to="/">
          Demiurge SSR
        </Link>
        <nav>
          <Link to="/">Home</Link>
          <Link to="/widgets">Widgets</Link>
          <Link to="/widgets/[id]" path={{ id: "north-star" }}>
            A widget
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
