import {
  Link,
  defineMetadata,
  type LayoutProps,
} from "@demiurgejs/core";

export const metadata = defineMetadata({
  description: "A Cloud Run deployment example for the Demiurge Node adapter.",
  title: {
    default: "Demiurge Cloud Run",
    format: (title) => `${title} | Demiurge Cloud Run`,
  },
});

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div className="shell">
      <header>
        <Link to="/">Demiurge Cloud Run</Link>
      </header>
      {children}
    </div>
  );
}
