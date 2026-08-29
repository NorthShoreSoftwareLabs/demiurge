export type SitemapChangeFrequency =
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";

export type SitemapAlternate = {
  href: string;
  hrefLang: string;
};

export type SitemapEntry = {
  alternates?: readonly SitemapAlternate[];
  changeFrequency?: SitemapChangeFrequency;
  lastModified?: Date | string;
  priority?: number;
  url: string;
};

export type Sitemap = {
  entries: readonly SitemapEntry[];
};

export type RobotsDirective = {
  allow?: string | readonly string[];
  disallow?: string | readonly string[];
  userAgent: string | readonly string[];
};

export type Robots = {
  host?: string;
  rules?: readonly RobotsDirective[];
  sitemap?: string | readonly string[];
};

export type OgImage = {
  background?: string;
  brand?: string;
  foreground?: string;
  height?: number;
  subtitle?: string;
  title: string;
  width?: number;
};

export function defineSitemap(entries: readonly SitemapEntry[]): Sitemap {
  return {
    entries: entries.map((entry) => ({
      ...entry,
      alternates: normalizeSitemapAlternates(entry.alternates ?? []),
    })),
  };
}

function normalizeSitemapAlternates(
  alternates: readonly SitemapAlternate[],
) {
  const byLanguage = new Map<string, string>();
  const byUrl = new Map<string, string>();

  for (const alternate of alternates) {
    const language = alternate.hrefLang.toLowerCase();
    let href: string;
    try {
      href = new URL(alternate.href).href;
    } catch {
      throw new Error(
        `Sitemap alternate URL must be absolute: ${JSON.stringify(alternate.href)}.`,
      );
    }
    const previousHref = byLanguage.get(language);
    const previousLanguage = byUrl.get(href);
    if (previousHref && previousHref !== href) {
      throw new Error(`Sitemap language ${JSON.stringify(alternate.hrefLang)} has conflicting URLs.`);
    }
    if (
      previousLanguage &&
      previousLanguage !== language &&
      previousLanguage !== "x-default" &&
      language !== "x-default"
    ) {
      throw new Error(`Sitemap URL ${JSON.stringify(alternate.href)} has conflicting languages.`);
    }
    byLanguage.set(language, href);
    byUrl.set(href, language);
  }

  return [...byLanguage].map(([hrefLang, href]) => ({ href, hrefLang }));
}

export function renderSitemap(sitemap: Sitemap) {
  const hasAlternates = sitemap.entries.some((entry) => entry.alternates?.length);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${hasAlternates ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : ""}>`,
    ...sitemap.entries.map(renderSitemapEntry),
    "</urlset>",
    "",
  ].join("\n");
}

export function defineRobots(options: Robots): Robots {
  return options;
}

export function defineOgImage(options: OgImage): OgImage {
  return options;
}

export function renderRobots(robots: Robots) {
  const lines: string[] = [];

  for (const rule of robots.rules ?? []) {
    for (const userAgent of toArray(rule.userAgent)) {
      lines.push(`User-agent: ${userAgent}`);
    }

    for (const allow of toArray(rule.allow)) {
      lines.push(`Allow: ${allow}`);
    }

    for (const disallow of toArray(rule.disallow)) {
      lines.push(`Disallow: ${disallow}`);
    }

    lines.push("");
  }

  if (robots.host) {
    lines.push(`Host: ${robots.host}`);
  }

  for (const sitemap of toArray(robots.sitemap)) {
    lines.push(`Sitemap: ${sitemap}`);
  }

  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

export function renderOgImageSvg(image: OgImage) {
  const width = image.width ?? 1200;
  const height = image.height ?? 630;
  const background = image.background ?? "#101820";
  const foreground = image.foreground ?? "#ffffff";
  const title = clampText(image.title, 120);
  const subtitle = image.subtitle ? clampText(image.subtitle, 160) : undefined;
  const brand = image.brand ? clampText(image.brand, 80) : undefined;

  validateOgImageDimensions(width, height);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXmlAttribute(title)}">`,
    `  <rect width="100%" height="100%" fill="${escapeXmlAttribute(background)}" />`,
    brand
      ? `  <text x="72" y="96" fill="${escapeXmlAttribute(foreground)}" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="32" font-weight="700">${escapeXml(brand)}</text>`
      : null,
    `  <text x="72" y="${subtitle ? 300 : 340}" fill="${escapeXmlAttribute(foreground)}" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="76" font-weight="800">${escapeXml(title)}</text>`,
    subtitle
      ? `  <text x="72" y="392" fill="${escapeXmlAttribute(foreground)}" fill-opacity="0.78" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="38" font-weight="500">${escapeXml(subtitle)}</text>`
      : null,
    "</svg>",
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function renderOgImageResponse(image: OgImage) {
  return new Response(renderOgImageSvg(image), {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-type": "image/svg+xml; charset=utf-8",
    },
  });
}

function renderSitemapEntry(entry: SitemapEntry) {
  return [
    "  <url>",
    `    <loc>${escapeXml(entry.url)}</loc>`,
    entry.lastModified
      ? `    <lastmod>${escapeXml(formatLastModified(entry.lastModified))}</lastmod>`
      : null,
    entry.changeFrequency
      ? `    <changefreq>${entry.changeFrequency}</changefreq>`
      : null,
    entry.priority !== undefined
      ? `    <priority>${formatPriority(entry.priority)}</priority>`
      : null,
    ...(entry.alternates ?? []).map(
      (alternate) =>
        `    <xhtml:link rel="alternate" hreflang="${escapeXmlAttribute(alternate.hrefLang)}" href="${escapeXmlAttribute(alternate.href)}" />`,
    ),
    "  </url>",
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function formatLastModified(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

function formatPriority(priority: number) {
  if (priority < 0 || priority > 1) {
    throw new Error("Sitemap entry priority must be between 0 and 1.");
  }

  return String(priority);
}

function toArray<T>(value: T | readonly T[] | undefined) {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeXmlAttribute(value: string) {
  return escapeXml(value)
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function clampText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function validateOgImageDimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || width <= 0) {
    throw new Error("OG image width must be a positive integer.");
  }

  if (!Number.isSafeInteger(height) || height <= 0) {
    throw new Error("OG image height must be a positive integer.");
  }
}
