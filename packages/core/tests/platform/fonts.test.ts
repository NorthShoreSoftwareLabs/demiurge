import { describe, expect, it } from "vitest";
import {
  createSecurityHeaders,
  defineFonts,
  font,
  fontAssetUrl,
  fontLinks,
  fontPreloadLinks,
  fontSources,
  renderFontFaceCss,
  security,
} from "@demiurgejs/core";

const brand = font.local({
  name: "Brand Sans",
  src: "fonts/brand.woff2",
  weight: "400 700",
});

describe("font planning", () => {
  it("publishes a local font from the application origin", () => {
    const fonts = defineFonts([brand]);

    expect(fontAssetUrl(fonts[0]!)).toBe(
      "/_demiurge/font/brand-sans-400-700-normal.woff2",
    );
    expect(fontLinks(fonts)).toEqual([
      {
        href: "/_demiurge/font/fonts.css",
        kind: "link",
        rel: "stylesheet",
      },
      {
        as: "font",
        crossOrigin: "anonymous",
        href: "/_demiurge/font/brand-sans-400-700-normal.woff2",
        kind: "link",
        rel: "preload",
        type: "font/woff2",
      },
    ]);
    expect(renderFontFaceCss(fonts)).toBe(
      '@font-face {\n  font-family: "Brand Sans";\n  src: url("/_demiurge/font/brand-sans-400-700-normal.woff2") format("woff2");\n  font-style: normal;\n  font-weight: 400 700;\n  font-display: swap;\n}',
    );
  });

  it("contributes nothing when the application declares no font", () => {
    expect(fontLinks(defineFonts([]))).toEqual([]);
    expect(renderFontFaceCss(defineFonts([]))).toBe("");
  });

  it("keeps a third-party host only when the application opts out", () => {
    const hosted = font.google({
      family: "Inter",
      selfHost: false,
      src: "https://fonts.gstatic.com/s/inter/inter.woff2",
    });

    expect(fontAssetUrl(font.google({
      family: "Inter",
      src: "https://fonts.gstatic.com/s/inter/inter.woff2",
    }))).toBe("/_demiurge/font/inter-400-normal.woff2");
    expect(fontPreloadLinks([hosted])[0]!.href).toBe(
      "https://fonts.gstatic.com/s/inter/inter.woff2",
    );
  });

  it("rejects a source that cannot become a self-hosted file", () => {
    expect(() => font.local({ name: "Brand", src: " " })).toThrow(
      "Local font source must not be empty.",
    );
    expect(() =>
      font.local({ name: "Brand", src: "https://fonts.example.com/a.woff2" })
    ).toThrow("must name a project file rather than a URL");
    expect(() => font.local({ name: "Brand", src: "fonts/brand.eot" })).toThrow(
      "has no known font extension",
    );
    expect(() => font.google({ family: "Inter", src: "/inter.woff2" })).toThrow(
      "needs an https font file URL",
    );
  });
});

describe("font content security policy", () => {
  it("needs nothing beyond 'self' for a self-hosted font", () => {
    const fonts = defineFonts([
      brand,
      font.google({
        family: "Inter",
        src: "https://fonts.gstatic.com/s/inter/inter.woff2",
      }),
    ]);

    expect(fontSources(fonts)).toEqual(["'self'"]);

    const headers = createSecurityHeaders(
      security.static({ csp: { fontSrc: fontSources(fonts) } }),
      {},
    );

    expect(headers.get("content-security-policy")).toContain("font-src 'self'");
  });

  it("names the third-party host that a hosted font still requires", () => {
    const fonts = defineFonts([
      brand,
      font.google({
        family: "Inter",
        selfHost: false,
        src: "https://fonts.gstatic.com/s/inter/inter.woff2",
      }),
    ]);

    expect(fontSources(fonts)).toEqual([
      "'self'",
      "https://fonts.gstatic.com",
    ]);

    const headers = createSecurityHeaders(
      security.static({ csp: { fontSrc: fontSources(fonts) } }),
      {},
    );

    expect(headers.get("content-security-policy")).toContain(
      "font-src 'self' https://fonts.gstatic.com",
    );
  });
});
