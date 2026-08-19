import { preload } from "../document/links";
import type { LinkTag } from "../document";

export type FontStyle = "normal" | "italic" | "oblique";

export type FontFormat = "otf" | "ttf" | "woff" | "woff2";

export type FontDefinition = {
  display: "auto" | "block" | "fallback" | "optional" | "swap";
  family: string;
  kind: "font";
  // A self-hosted font is published from the application origin, so `'self'`
  // covers it. A font left on a third-party host stays a `font-src` entry and
  // a privacy question, and `fontSources` makes that cost visible.
  selfHost: boolean;
  source: "google" | "local";
  src: string;
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
  src: string;
  style?: FontStyle;
  weight?: FontDefinition["weight"];
};

export type FontContribution = readonly FontDefinition[];

// The framework publishes every self-hosted font under one path. The build
// writes the files, and the Node handler serves the same URLs at request time.
export const defaultFontPath = "/_demiurge/font";

const fontFormats: Record<string, FontFormat> = {
  otf: "otf",
  ttf: "ttf",
  woff: "woff",
  woff2: "woff2",
};

const fontFaceFormats: Record<FontFormat, string> = {
  otf: "opentype",
  ttf: "truetype",
  woff: "woff",
  woff2: "woff2",
};

const fontMediaTypes: Record<FontFormat, string> = {
  otf: "font/otf",
  ttf: "font/ttf",
  woff: "font/woff",
  woff2: "font/woff2",
};

export const font = {
  // A Google font needs the file URL that the Google stylesheet points at.
  // The framework reads no third-party stylesheet, because that request is
  // the privacy cost self-hosting removes.
  google(options: GoogleFontOptions): FontDefinition {
    const src = options.src.trim();

    if (!isRemoteSource(src)) {
      throw new Error(
        `Google font ${JSON.stringify(options.family)} needs an https font file URL as its source.`,
      );
    }

    assertKnownFormat(src);

    return {
      display: options.display ?? "swap",
      family: options.family,
      kind: "font",
      selfHost: options.selfHost ?? true,
      source: "google",
      src,
      style: options.style ?? "normal",
      weight: options.weight ?? 400,
    };
  },
  // A local font names a file in the project. The build reads that file and
  // publishes it, so the file does not have to sit in the public directory.
  local(options: LocalFontOptions): FontDefinition {
    const src = options.src.trim();

    if (!src) {
      throw new Error("Local font source must not be empty.");
    }

    if (isRemoteSource(src)) {
      throw new Error(
        `Local font ${JSON.stringify(options.name)} must name a project file rather than a URL.`,
      );
    }

    assertKnownFormat(src);

    return {
      display: options.display ?? "swap",
      family: options.name,
      kind: "font",
      selfHost: true,
      source: "local",
      src,
      style: options.style ?? "normal",
      weight: options.weight ?? 400,
    };
  },
};

export function defineFonts(fonts: FontContribution): FontContribution {
  return [...fonts];
}

// The published file name derives from the declaration alone. The renderer
// and the build therefore agree on every URL without sharing any state.
export function fontAssetFileName(definition: FontDefinition) {
  const family = slug(definition.family);
  const weight = slug(String(definition.weight));

  return `${family}-${weight}-${definition.style}.${fontFormat(definition.src)}`;
}

export function fontAssetUrl(
  definition: FontDefinition,
  basePath: string = defaultFontPath,
) {
  return definition.selfHost
    ? `${basePath}/${fontAssetFileName(definition)}`
    : definition.src;
}

export function fontStylesheetUrl(basePath: string = defaultFontPath) {
  return `${basePath}/fonts.css`;
}

export function fontMediaType(file: string) {
  return fontMediaTypes[fontFormat(file)];
}

export function fontFormat(file: string): FontFormat {
  const name = file.split("?")[0]!.split("#")[0]!.split("/").at(-1) ?? "";
  const extension = name.includes(".")
    ? name.split(".").at(-1)!.toLowerCase()
    : "";
  const format = fontFormats[extension];

  if (!format) {
    throw new Error(
      `Font source ${JSON.stringify(file)} has no known font extension.`,
    );
  }

  return format;
}

// The stylesheet and the preload links are the whole document contribution.
// An application spreads them into `links` in its root layout.
export function fontLinks(
  fonts: FontContribution,
  basePath: string = defaultFontPath,
): LinkTag[] {
  if (fonts.length === 0) {
    return [];
  }

  return [
    {
      href: fontStylesheetUrl(basePath),
      kind: "link" as const,
      rel: "stylesheet",
    },
    ...fontPreloadLinks(fonts, basePath),
  ];
}

export function fontPreloadLinks(
  fonts: FontContribution,
  basePath: string = defaultFontPath,
): LinkTag[] {
  return fonts.map((definition) =>
    preload(fontAssetUrl(definition, basePath), {
      as: "font",
      // A font request runs in CORS mode even on the same origin. A preload
      // without this attribute fetches the file twice.
      crossOrigin: "anonymous",
      type: fontMediaType(definition.src),
    })
  );
}

export function renderFontFaceCss(
  fonts: FontContribution,
  basePath: string = defaultFontPath,
) {
  return fonts
    .map((definition) => {
      const url = fontAssetUrl(definition, basePath);

      return [
        "@font-face {",
        `  font-family: "${escapeCss(definition.family)}";`,
        `  src: url("${escapeCss(url)}") format("${
          fontFaceFormats[fontFormat(definition.src)]
        }");`,
        `  font-style: ${definition.style};`,
        `  font-weight: ${definition.weight};`,
        `  font-display: ${definition.display};`,
        "}",
      ].join("\n");
    })
    .join("\n");
}

// A self-hosted font set collapses to `'self'`, which every framework preset
// already declares. A third-party host has to be named here instead.
export function fontSources(fonts: FontContribution): string[] {
  const origins = new Set<string>();

  for (const definition of fonts) {
    if (!definition.selfHost) {
      origins.add(new URL(definition.src).origin);
    }
  }

  return ["'self'", ...[...origins].sort()];
}

function isRemoteSource(src: string) {
  return /^https?:\/\//i.test(src);
}

function assertKnownFormat(src: string) {
  fontFormat(src);
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "font";
}

function escapeCss(value: string) {
  return value.replace(/[\\"]/g, "\\$&");
}
