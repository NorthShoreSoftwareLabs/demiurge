import { describe, expect, it } from "vitest";
import {
  defineOgImage,
  defineRobots,
  defineSitemap,
  renderOgImageResponse,
  renderOgImageSvg,
  renderRobots,
  renderSitemap,
} from "@demiurgejs/core";

describe("document SEO outputs", () => {
  it("renders escaped sitemap XML with alternates", () => {
    const sitemap = defineSitemap([
      {
        alternates: [
          {
            href: "https://example.com/es/blog?a=1&b=2",
            hrefLang: "es",
          },
        ],
        changeFrequency: "weekly",
        lastModified: new Date("2026-01-02T03:04:05.000Z"),
        priority: 0.8,
        url: "https://example.com/blog?a=1&b=2",
      },
    ]);

    expect(renderSitemap(sitemap)).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://example.com/blog?a=1&amp;b=2</loc>
    <lastmod>2026-01-02T03:04:05.000Z</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
    <xhtml:link rel="alternate" hreflang="es" href="https://example.com/es/blog?a=1&amp;b=2" />
  </url>
</urlset>
`);
  });

  it("rejects sitemap priorities outside the protocol range", () => {
    expect(() =>
      renderSitemap(defineSitemap([
        {
          priority: 2,
          url: "https://example.com/",
        },
      ])),
    ).toThrow("Sitemap entry priority must be between 0 and 1.");
  });

  it("renders robots.txt directives, host, and sitemap lines", () => {
    const robots = defineRobots({
      host: "https://example.com",
      rules: [
        {
          allow: ["/", "/blog"],
          disallow: "/admin",
          userAgent: ["*", "Googlebot"],
        },
      ],
      sitemap: [
        "https://example.com/sitemap.xml",
        "https://example.com/news-sitemap.xml",
      ],
    });

    expect(renderRobots(robots)).toBe(`User-agent: *
User-agent: Googlebot
Allow: /
Allow: /blog
Disallow: /admin

Host: https://example.com
Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/news-sitemap.xml
`);
  });

  it("renders escaped deterministic OG image SVG", () => {
    const image = defineOgImage({
      background: "#003344",
      brand: "Demiurge <Framework>",
      foreground: "#ffffff",
      subtitle: "Typed routes & strict CSP",
      title: "Build <secure> apps",
    });

    expect(renderOgImageSvg(image)).toContain(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="Build &lt;secure&gt; apps">',
    );
    expect(renderOgImageSvg(image)).toContain("Demiurge &lt;Framework&gt;");
    expect(renderOgImageSvg(image)).toContain("Build &lt;secure&gt; apps");
    expect(renderOgImageSvg(image)).toContain("Typed routes &amp; strict CSP");
  });

  it("creates cacheable OG image responses", async () => {
    const response = renderOgImageResponse(defineOgImage({
      title: "Hello",
    }));

    expect(response.headers.get("content-type")).toBe(
      "image/svg+xml; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    await expect(response.text()).resolves.toContain(">Hello</text>");
  });

  it("rejects invalid OG image dimensions", () => {
    expect(() =>
      renderOgImageSvg(defineOgImage({
        height: 630,
        title: "Hello",
        width: 0,
      })),
    ).toThrow("OG image width must be a positive integer.");
  });
});
