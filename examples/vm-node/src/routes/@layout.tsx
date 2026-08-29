import {
  Link,
  defineMetadata,
  type LayoutProps,
} from "@demiurgejs/core";

export const metadata = defineMetadata({
  description: "A VM and bare-metal deployment example for the Demiurge Node adapter.",
  title: {
    default: "Demiurge VM Node",
    format: (title) => `${title} | Demiurge VM Node`,
  },
});

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div className="shell">
      <header>
        <Link to="/">Demiurge VM Node</Link>
      </header>
      {children}
    </div>
  );
}
