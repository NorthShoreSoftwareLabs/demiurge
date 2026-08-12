import { describe, expect, it } from "vitest";
import { defineFonts, font, fontPreloadLinks, renderFontFaceCss } from "@demiurge-js/core";

describe("font planning", () => {
  it("renders local font faces and deterministic preload links", () => {
    const fonts = defineFonts([
      font.local({
        name: "Brand \"Sans\"",
        src: "/fonts/brand.woff2?v=2",
        weight: "400 700",
      }),
    ]);

    expect(fontPreloadLinks(fonts)).toEqual([
      {
        as: "font",
        crossOrigin: "anonymous",
        href: "/fonts/brand.woff2?v=2",
        kind: "link",
        rel: "preload",
        type: "font/woff2",
      },
    ]);
    expect(renderFontFaceCss(fonts)).toBe(
      '@font-face {\n  font-family: "Brand \\"Sans\\"";\n  src: url("/fonts/brand.woff2?v=2") format("woff2");\n  font-style: normal;\n  font-weight: 400 700;\n  font-display: swap;\n}',
    );
  });

  it("preserves self-hosted Google font intent without adding a runtime request", () => {
    const fonts = defineFonts([
      font.google({ family: "Inter", selfHost: true }),
      font.google({ family: "Roboto", src: "https://fonts.example.com/roboto.woff2" }),
    ]);

    expect(fontPreloadLinks(fonts)).toEqual([
      {
        as: "font",
        crossOrigin: "anonymous",
        href: "https://fonts.example.com/roboto.woff2",
        kind: "link",
        rel: "preload",
        type: "font/woff2",
      },
    ]);
    expect(renderFontFaceCss(fonts)).toBe("");
  });

  it("rejects empty local sources", () => {
    expect(() => font.local({ name: "Brand", src: " " })).toThrow(
      "Local font source must not be empty.",
    );
  });
});
