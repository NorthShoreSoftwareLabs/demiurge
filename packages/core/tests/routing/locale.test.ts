import { describe, expect, it } from "vitest";
import { applicationPathname, defineLocales, localizeHref, resolveLocale } from "@demiurgejs/core";

const locales = defineLocales({
  aliases: { english: "en", french: "fr" },
  cookie: { name: "locale" },
  defaultLocale: "en",
  path: {
    labels: { en: "en", fr: "fr" },
    reserved: ["de"],
  },
  supportedLocales: ["en", "fr"],
} as const);

describe("locale-aware routes", () => {
  it("removes declared prefixes from application route matching", () => {
    const result = resolveLocale(new Request("https://example.test/fr/blog?q=1"), locales);
    expect(result).toMatchObject({ locale: "fr", pathname: "/blog", source: "path", unsupported: false });
    expect(result.redirect).toBeUndefined();
  });

  it("canonicalizes aliases and preserves the query", () => {
    const result = resolveLocale(new Request("https://example.test/french/blog?q=1"), locales);
    expect(result.redirect?.href).toBe("https://example.test/fr/blog?q=1");
  });

  it("uses preference inputs only for a locale-free URL", () => {
    const result = resolveLocale(new Request("https://example.test/blog", {
      headers: { cookie: "locale=fr", "accept-language": "en;q=1" },
    }), locales);
    expect(result).toMatchObject({ locale: "fr", source: "cookie" });
    expect(result.redirect?.pathname).toBe("/fr/blog");
  });

  it("does not consume undeclared application route segments", () => {
    expect(resolveLocale(new Request("https://example.test/about"), locales).pathname).toBe("/about");
  });

  it("reserves declared unsupported locale labels", () => {
    expect(resolveLocale(new Request("https://example.test/de/blog"), locales)).toMatchObject({
      pathname: "/blog",
      unsupported: true,
    });
  });

  it("changes locale without changing route, query, or fragment", () => {
    expect(localizeHref("/fr/blog?q=1#post", "en", locales)).toBe("/blog?q=1#post");
    expect(localizeHref("/blog?q=1#post", "fr", locales)).toBe("/fr/blog?q=1#post");
  });

  it("rejects ambiguous multi-locale configuration", () => {
    expect(() => defineLocales({ defaultLocale: "en", supportedLocales: ["en", "fr"] })).toThrow(
      "Multiple locales require a path or domain binding.",
    );
  });

  it("resolves weighted language preferences and wildcard fallback", () => {
    const french = resolveLocale(new Request("https://example.test/", {
      headers: { "accept-language": "en;q=0, fr-CA;q=0.8" },
    }), locales);
    expect(french).toMatchObject({ locale: "fr", source: "accept-language" });
    expect(resolveLocale(new Request("https://example.test/", {
      headers: { "accept-language": "zz, *;q=0.5" },
    }), locales).locale).toBe("en");
  });

  it("resolves canonical domains and creates cross-domain links", () => {
    const domains = defineLocales({
      defaultLocale: "en",
      domains: { en: "en.example.test", fr: "fr.example.test" },
      supportedLocales: ["en", "fr"],
    } as const);
    expect(resolveLocale(new Request("https://fr.example.test/blog"), domains)).toMatchObject({
      locale: "fr",
      source: "domain",
    });
    expect(localizeHref("/blog", "fr", domains, "https://en.example.test/")).toBe(
      "https://fr.example.test/blog",
    );
  });

  it("can keep the default locale prefix", () => {
    const prefixed = defineLocales({
      defaultLocale: "en",
      path: { labels: { en: "en", fr: "fr" }, prefixDefault: true },
      supportedLocales: ["en", "fr"],
    } as const);
    expect(localizeHref("/about", "en", prefixed)).toBe("/en/about");
  });

  it("returns application pathnames with and without configuration", () => {
    expect(applicationPathname("/fr/blog", locales)).toBe("/blog");
    expect(applicationPathname("/about", locales)).toBe("/about");
    expect(applicationPathname("/about")).toBe("/about");
  });

  it("rejects invalid locale configuration", () => {
    expect(() => defineLocales({ defaultLocale: "en", supportedLocales: [] })).toThrow(
      "at least one supported locale",
    );
    expect(() => defineLocales({
      defaultLocale: "fr",
      supportedLocales: ["en"],
    })).toThrow("default locale must be supported");
    expect(() => defineLocales({
      defaultLocale: "en-US",
      supportedLocales: ["en-US", "en-us"],
    })).toThrow("duplicate canonical locales");
  });
});
