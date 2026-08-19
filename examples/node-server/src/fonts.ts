import { defineFonts, font } from "@demiurgejs/core";

// The font file lives in the project rather than in the public directory.
// `createFontAssetHandler` publishes it under /_demiurge/font, so the browser
// never reaches a third-party font host.
export const fonts = defineFonts([
  font.local({
    name: "Inter",
    src: "fonts/inter-latin.woff2",
    weight: "100 900",
  }),
]);
