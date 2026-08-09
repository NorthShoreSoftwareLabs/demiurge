import type { LinkTag } from "../document";

export type FontStyle = "normal" | "italic" | "oblique";

export type FontDefinition = {
  display: "auto" | "block" | "fallback" | "optional" | "swap";
  family: string;
  kind: "font";
  source: "google" | "local";
  src?: string;
  style: FontStyle;
  weight: number | `${number} ${number}`;
};

export type LocalFontOptions = {
  display?: FontDefinition["display"];
  name: string;
  src: string;
  style?: FontStyle;
  weight?: FontDefinition["weight"];
};

export type GoogleFontOptions = {
  display?: FontDefinition["display"];
  family: string;
  selfHost?: boolean;
  src?: string;
  style?: FontStyle;
  weight?: FontDefinition["weight"];
};

export type FontContribution = readonly FontDefinition[];

export const font = {
  google(options: GoogleFontOptions): FontDefinition {
    return {
      display: options.display ?? "swap",
      family: options.family,
      kind: "font",
      source: "google",
      src: options.src,
      style: options.style ?? "normal",
      weight: options.weight ?? 400,
    };
  },
  local(options: LocalFontOptions): FontDefinition {
    if (!options.src.trim()) {
      throw new Error("Local font source must not be empty.");
    }

    return {
      display: options.display ?? "swap",
      family: options.name,
      kind: "font",
      source: "local",
      src: options.src,
      style: options.style ?? "normal",
      weight: options.weight ?? 400,
    };
  },
};

export function defineFonts(fonts: FontContribution): FontContribution {
  return [...fonts];
}

export function fontPreloadLinks(fonts: FontContribution): LinkTag[] {
  return fonts
    .filter((definition) => definition.src)
    .map((definition) => ({
      as: "font",
      crossOrigin: "anonymous",
      href: definition.src as string,
      kind: "link" as const,
      rel: "preload",
      type: fontType(definition.src as string),
    }));
}

export function renderFontFaceCss(fonts: FontContribution): string {
  return fonts
    .filter((definition) => definition.source === "local" && definition.src)
    .map((definition) => {
      const src = definition.src as string;

      return [
        "@font-face {",
        `  font-family: "${escapeCss(definition.family)}";`,
        `  src: url("${escapeCss(src)}") format("${fontFormat(src)}");`,
        `  font-style: ${definition.style};`,
        `  font-weight: ${definition.weight};`,
        `  font-display: ${definition.display};`,
        "}",
      ].join("\n");
    })
    .join("\n");
}

function fontType(src: string) {
  const extension = src.split("?")[0].split("#")[0].split(".").pop()?.toLowerCase();

  return extension === "woff" ? "font/woff" : "font/woff2";
}

function fontFormat(src: string) {
  const extension = src.split("?")[0].split("#")[0].split(".").pop()?.toLowerCase();

  return extension === "woff" ? "woff" : "woff2";
}

function escapeCss(value: string) {
  return value.replace(/[\\"]/g, "\\$&");
}
