import { describe, expect, it } from "vitest";
import {
  defineMetadata,
  link,
  meta,
  resolveMetadata,
  structuredData,
} from "@demiurgejs/core";

describe("document metadata", () => {
  it("defines app-owned metadata objects", () => {
    const metadata = defineMetadata({
      canonical: "/checkout",
      description: "Complete your order securely.",
      robots: {
        follow: false,
        index: false,
      },
      title: "Checkout",
    });

    expect(metadata.title).toBe("Checkout");
    expect(metadata.robots).toEqual({ follow: false, index: false });
  });

  it("resolves title defaults and formatters from parent to child", () => {
    const metadata = resolveMetadata(
      {
        description: "A tiny React framework.",
        title: {
          default: "Demiurge",
          format: (title) => `${title} | Demiurge`,
        },
      },
      {
        title: "Blog",
      },
    );

    expect(metadata.title).toBe("Blog | Demiurge");
    expect(metadata.description).toBe("A tiny React framework.");
    expect(metadata.openGraph).toEqual({
      description: "A tiny React framework.",
      title: "Blog | Demiurge",
    });
  });

  it("leaves the default title unformatted when no route supplies one", () => {
    const metadata = resolveMetadata({
      title: {
        default: "Demiurge",
        format: (title) => `${title} | Demiurge`,
      },
    });

    expect(metadata.title).toBe("Demiurge");
  });

  it("lets leaf metadata override scalar fields and merge structured fields", () => {
    const metadata = resolveMetadata(
      {
        canonical: "/",
        openGraph: {
          image: "/root-og.png",
          title: "Root OG",
        },
        robots: {
          follow: true,
          index: true,
        },
      },
      {
        canonical: "/checkout",
        description: "Checkout description.",
        openGraph: {
          title: "Checkout OG",
        },
        robots: {
          index: false,
        },
      },
    );

    expect(metadata.canonical).toBe("/checkout");
    expect(metadata.robots).toEqual({ follow: true, index: false });
    expect(metadata.openGraph).toEqual({
      description: "Checkout description.",
      image: "/root-og.png",
      title: "Checkout OG",
    });
  });

  it("preserves custom metadata and default document tags", () => {
    const metadata = resolveMetadata({
      custom: [
        meta({ content: "#ffffff", name: "theme-color" }),
        link({ href: "/feed.xml", rel: "alternate" }),
      ],
    });

    expect(metadata.charset).toBe("utf-8");
    expect(metadata.viewport).toBe("width=device-width, initial-scale=1");
    expect(metadata.custom).toEqual([
      { content: "#ffffff", kind: "meta", name: "theme-color" },
      { href: "/feed.xml", kind: "link", rel: "alternate" },
    ]);
  });

  it("collects structured data entries from parent to child metadata", () => {
    const organization = structuredData({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Demiurge",
    });
    const article = structuredData({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "File based routing",
    });
    const metadata = resolveMetadata(
      defineMetadata({
        structuredData: [organization],
      }),
      defineMetadata({
        structuredData: [article],
      }),
    );

    expect(metadata.structuredData).toEqual([organization, article]);
  });
});
