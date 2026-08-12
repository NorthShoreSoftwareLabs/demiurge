import { describe, expect, it } from "vitest";
import {
  defineMetadata,
  link,
  meta,
  modulePreload,
  preconnect,
  preload,
  resolveMetadata,
  script,
  structuredData,
} from "@demiurge-js/core";
import {
  HYDRATION_DATA_ELEMENT_ID,
  HYDRATION_ROOT_ATTRIBUTE,
  renderDocument,
} from "../../src/document";

describe("renderDocument static shell", () => {
  it("renders an empty root with no bootstrap data when no body is given", () => {
    const html = renderDocument({
      entrySrc: "/assets/app.js",
    });

    expect(html).toContain('<div id="root"></div>');
    expect(html).not.toContain(HYDRATION_ROOT_ATTRIBUTE);
    expect(html).not.toContain(HYDRATION_DATA_ELEMENT_ID);
    expect(html).not.toContain('type="application/json"');
    expect(html).toContain(
      '<script type="module" src="/assets/app.js"></script>',
    );
  });

  it("defaults lang to en and title to Demiurge App", () => {
    const html = renderDocument({});

    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<title>Demiurge App</title>");
  });

  it("omits the client entry script when entrySrc is absent", () => {
    const html = renderDocument({});

    expect(html).not.toContain('type="module"');
  });
});

describe("renderDocument with a rendered body", () => {
  it("marks the root as hydratable and nests the server-rendered markup", () => {
    const html = renderDocument({
      body: {
        data: { greeting: "hello" },
        html: "<main>Hello</main>",
      },
      entrySrc: "/assets/app.js",
    });

    expect(html).toContain(
      `<div id="root" ${HYDRATION_ROOT_ATTRIBUTE}=""><main>Hello</main></div>`,
    );
  });

  it("emits inert bootstrap data carrying the resolved route data", () => {
    const html = renderDocument({
      body: {
        data: { greeting: "hello" },
        html: "<main>Hello</main>",
      },
    });

    expect(html).toContain(`id="${HYDRATION_DATA_ELEMENT_ID}"`);
    expect(html).toContain(`<template id="${HYDRATION_DATA_ELEMENT_ID}">`);
    expect(html).not.toContain('type="application/json"');
    expect(html).toContain('"data":{"greeting":"hello"}');
    expect(html).toContain('"hasData":true');
  });

  it("omits the bootstrap data when no body is given", () => {
    const html = renderDocument({});

    expect(html).not.toContain(HYDRATION_DATA_ELEMENT_ID);
  });
});

describe("renderDocument head metadata", () => {
  it("renders escaped stylesheet links before resource hints", () => {
    const html = renderDocument({
      links: [preconnect("https://api.example.com")],
      styles: ["/assets/app.css?theme=light&v=1"],
    });

    expect(html).toContain(
      '<link rel="stylesheet" href="/assets/app.css?theme=light&amp;v=1" />',
    );
    expect(html.indexOf('rel="stylesheet"')).toBeLessThan(
      html.indexOf('rel="preconnect"'),
    );
  });

  it("renders title, description, canonical, robots, Open Graph, custom tags, and structured data", () => {
    const html = renderDocument({
      metadata: resolveMetadata(
        defineMetadata({
          canonical: "/checkout",
          custom: [
            meta({ content: "#fff", name: "theme-color" }),
            link({ href: "/feed.xml", rel: "alternate" }),
          ],
          description: "Complete your order.",
          openGraph: {
            image: "/og.png",
          },
          robots: {
            follow: false,
            index: false,
          },
          structuredData: [
            structuredData({
              "@context": "https://schema.org",
              "@type": "Article",
              headline: "Checkout",
            }),
          ],
          title: "Checkout",
        }),
      ),
    });

    expect(html).toContain("<title>Checkout</title>");
    expect(html).toContain(
      '<meta name="description" content="Complete your order." />',
    );
    expect(html).toContain('<link rel="canonical" href="/checkout" />');
    expect(html).toContain(
      '<meta name="robots" content="noindex, nofollow" />',
    );
    expect(html).toContain(
      '<meta property="og:title" content="Checkout" />',
    );
    expect(html).toContain('<meta property="og:image" content="/og.png" />');
    expect(html).toContain('<meta name="theme-color" content="#fff" />');
    expect(html).toContain('<link rel="alternate" href="/feed.xml" />');
    expect(html).toContain(
      '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Checkout"}</script>',
    );
  });

  it("defaults charset and viewport, and lets metadata override charset", () => {
    const defaultHtml = renderDocument({});

    expect(defaultHtml).toContain('<meta charset="UTF-8" />');
    expect(defaultHtml).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    );

    const metadataHtml = renderDocument({
      metadata: resolveMetadata(defineMetadata({})),
    });

    expect(metadataHtml).toContain('<meta charset="utf-8" />');
  });

  it("falls back to the provided title when metadata has no title", () => {
    const html = renderDocument({
      metadata: resolveMetadata(defineMetadata({ description: "Untitled" })),
      title: "Fallback Title",
    });

    expect(html).toContain("<title>Fallback Title</title>");
  });
});

describe("renderDocument resource hints and static scripts", () => {
  it("renders resource-hint links and static script tags with a shared nonce", () => {
    const html = renderDocument({
      links: [
        preconnect("https://api.example.com", { crossOrigin: "anonymous" }),
        preload("/hero.avif", { as: "image", type: "image/avif" }),
        modulePreload("/assets/editor.js"),
      ],
      nonce: "doc-nonce",
      scripts: [
        script({
          integrity: "sha384-demo",
          src: "https://cdn.example.com/app.js",
        }),
      ],
    });

    expect(html).toContain(
      '<link rel="preconnect" href="https://api.example.com" crossorigin="anonymous" />',
    );
    expect(html).toContain(
      '<link rel="preload" href="/hero.avif" as="image" type="image/avif" />',
    );
    expect(html).toContain(
      '<link rel="modulepreload" href="/assets/editor.js" />',
    );
    expect(html).toContain(
      '<script src="https://cdn.example.com/app.js" nonce="doc-nonce" integrity="sha384-demo"></script>',
    );
  });

  it("lets a script's own nonce take priority over the document nonce", () => {
    const html = renderDocument({
      nonce: "doc-nonce",
      scripts: [
        script({
          nonce: "script-nonce",
          src: "https://cdn.example.com/explicit.js",
        }),
      ],
    });

    expect(html).toContain(
      '<script src="https://cdn.example.com/explicit.js" nonce="script-nonce"></script>',
    );
  });
});

describe("renderDocument HTML escaping", () => {
  it("escapes hostile lang, title, and metadata values", () => {
    const html = renderDocument({
      lang: 'en" data-test="bad',
      metadata: resolveMetadata(
        defineMetadata({
          canonical: '/checkout"><script>alert(1)</script>',
          description: '"><script>alert(1)</script>',
          title: "Checkout <Secure>",
        }),
      ),
    });

    expect(html).toContain('<html lang="en&quot; data-test=&quot;bad">');
    expect(html).toContain("<title>Checkout &lt;Secure&gt;</title>");
    expect(html).toContain(
      '<meta name="description" content="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;" />',
    );
    expect(html).toContain(
      '<link rel="canonical" href="/checkout&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;" />',
    );
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("escapes hostile structured data values so they cannot break out of the script tag", () => {
    const html = renderDocument({
      metadata: resolveMetadata(
        defineMetadata({
          structuredData: [
            structuredData({
              "@context": "https://schema.org",
              "@type": "Article",
              headline: "Checkout </script>",
            }),
          ],
        }),
      ),
    });

    expect(html).toContain(
      '"headline":"Checkout \\u003c/script\\u003e"',
    );
    expect(html).not.toContain("</script>alert");
  });
});

describe("renderDocument nonce propagation", () => {
  it("applies the document nonce to scripts but not inert bootstrap data", () => {
    const html = renderDocument({
      body: {
        data: { ok: true },
        html: "<main>Hello</main>",
      },
      entrySrc: "/assets/app.js",
      metadata: resolveMetadata(
        defineMetadata({
          structuredData: [
            structuredData({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "Demiurge",
            }),
          ],
        }),
      ),
      nonce: "doc-nonce",
      scripts: [
        script({
          src: "https://cdn.example.com/app.js",
        }),
      ],
    });

    expect(html).toContain(
      '<script type="application/ld+json" nonce="doc-nonce">',
    );
    expect(html).toContain(
      '<script src="https://cdn.example.com/app.js" nonce="doc-nonce"></script>',
    );
    expect(html).toContain(`<template id="${HYDRATION_DATA_ELEMENT_ID}">`);
    expect(html).not.toContain(
      `<template id="${HYDRATION_DATA_ELEMENT_ID}" nonce=`,
    );
    expect(html).toContain(
      '<script type="module" src="/assets/app.js" nonce="doc-nonce"></script>',
    );
  });
});
