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

export function defineSitemap(entries: readonly SitemapEntry[]): Sitemap {
  return {
    entries,
  };
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
