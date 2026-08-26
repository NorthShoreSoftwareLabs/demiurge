export interface RouteLocales {}

type KnownLocale = keyof RouteLocales & string;
export type AppLocale = [KnownLocale] extends [never] ? string : KnownLocale;
export type LocaleSource = "path" | "domain" | "cookie" | "accept-language" | "default";

export type LocaleConfiguration<TLocale extends string = string> = {
  aliases?: Readonly<Record<string, TLocale>>;
  cookie?: { name: string };
  defaultLocale: TLocale;
  domains?: Partial<Readonly<Record<TLocale, string>>>;
  path?: {
    labels: Readonly<Record<TLocale, string>>;
    prefixDefault?: boolean;
    reserved?: readonly string[];
  };
  supportedLocales: readonly TLocale[];
};

export type LocaleResolution<TLocale extends string = string> = {
  locale: TLocale;
  pathname: string;
  redirect?: URL;
  source: LocaleSource;
  unsupported: boolean;
};

export function defineLocales<const TLocale extends string>(configuration: LocaleConfiguration<TLocale>) {
  validateLocales(configuration);
  return configuration;
}

export function resolveLocale<TLocale extends string>(
  request: Request,
  configuration: LocaleConfiguration<TLocale>,
): LocaleResolution<TLocale> {
  validateLocales(configuration);
  const url = new URL(request.url);
  const [label = "", ...rest] = url.pathname.slice(1).split("/");
  const pathLocale = localeForLabel(label, configuration);
  const unsupported = configuration.path?.reserved?.some(
    (value) => value.toLowerCase() === label.toLowerCase(),
  ) ?? false;
  const domainLocale = localeForDomain(url.hostname, configuration);
  const cookie = cookieLocale(request, configuration);
  const language = languageLocale(request.headers.get("accept-language"), configuration);
  const locale = pathLocale ?? domainLocale ?? cookie ?? language ?? configuration.defaultLocale;
  const source: LocaleSource = pathLocale ? "path" : domainLocale ? "domain" : cookie ? "cookie" : language ? "accept-language" : "default";
  const pathname = pathLocale || unsupported ? `/${rest.join("/")}`.replace(/\/$/, "") || "/" : url.pathname;
  const canonical = localeUrl(url, pathname, locale, configuration);
  return {
    locale,
    pathname,
    redirect: !unsupported && canonical.href !== url.href ? canonical : undefined,
    source,
    unsupported,
  };
}

export function localizeHref<TLocale extends string>(
  href: string,
  locale: TLocale,
  configuration: LocaleConfiguration<TLocale>,
  base = "http://demiurge.local",
) {
  const url = new URL(href, base);
  const current = localeForLabel(url.pathname.slice(1).split("/")[0] ?? "", configuration);
  const pathname = current ? `/${url.pathname.slice(1).split("/").slice(1).join("/")}`.replace(/\/$/, "") || "/" : url.pathname;
  const result = localeUrl(url, pathname, locale, configuration);
  const baseUrl = new URL(base);
  return result.origin === baseUrl.origin
    ? `${result.pathname}${result.search}${result.hash}`
    : result.href;
}

export function applicationPathname<TLocale extends string>(pathname: string, configuration?: LocaleConfiguration<TLocale>) {
  if (!configuration) return pathname;
  const parts = pathname.slice(1).split("/");
  return localeForLabel(parts[0] ?? "", configuration)
    ? `/${parts.slice(1).join("/")}`.replace(/\/$/, "") || "/"
    : pathname;
}

function localeUrl<TLocale extends string>(source: URL, pathname: string, locale: TLocale, configuration: LocaleConfiguration<TLocale>) {
  const result = new URL(source);
  const label = configuration.path?.labels[locale];
  const prefix = label && (locale !== configuration.defaultLocale || configuration.path?.prefixDefault);
  result.pathname = prefix ? `/${label}${pathname === "/" ? "" : pathname}` : pathname;
  const domain = configuration.domains?.[locale];
  if (domain) result.hostname = domain;
  return result;
}

function localeForLabel<TLocale extends string>(label: string, configuration: LocaleConfiguration<TLocale>) {
  const entry = Object.entries(configuration.path?.labels ?? {}).find(([, value]) => String(value).toLowerCase() === label.toLowerCase());
  if (entry) {
    // TYPE-EVIDENCE: LocaleConfiguration keys each path label with TLocale.
    return entry[0] as TLocale;
  }
  // TYPE-EVIDENCE: LocaleConfiguration constrains every alias target to TLocale.
  return Object.entries(configuration.aliases ?? {}).find(([value]) => value.toLowerCase() === label.toLowerCase())?.[1] as TLocale | undefined;
}

function localeForDomain<TLocale extends string>(host: string, configuration: LocaleConfiguration<TLocale>) {
  // TYPE-EVIDENCE: LocaleConfiguration keys each domain with TLocale.
  return Object.entries(configuration.domains ?? {}).find(([, value]) => String(value).toLowerCase() === host.toLowerCase())?.[0] as TLocale | undefined;
}

function cookieLocale<TLocale extends string>(request: Request, configuration: LocaleConfiguration<TLocale>) {
  const name = configuration.cookie?.name;
  if (!name) return undefined;
  const value = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
  return configuration.supportedLocales.find((locale) => locale === value);
}

function languageLocale<TLocale extends string>(header: string | null, configuration: LocaleConfiguration<TLocale>) {
  if (!header) return undefined;
  const values = header.split(",").map((part, order) => {
    const [tag = "", parameter] = part.trim().split(";");
    return { order, q: parameter?.trim().startsWith("q=") ? Number(parameter.trim().slice(2)) : 1, tag };
  }).filter(({ q }) => q > 0).sort((a, b) => b.q - a.q || a.order - b.order);
  for (const value of values) {
    if (value.tag === "*") return configuration.defaultLocale;
    const exact = configuration.supportedLocales.find((locale) => locale.toLowerCase() === value.tag.toLowerCase());
    if (exact) return exact;
    const language = value.tag.split("-")[0]?.toLowerCase();
    const partial = configuration.supportedLocales.find((locale) => locale.split("-")[0]?.toLowerCase() === language);
    if (partial) return partial;
  }
  return undefined;
}

function validateLocales<TLocale extends string>(configuration: LocaleConfiguration<TLocale>) {
  if (configuration.supportedLocales.length === 0) throw new Error("Locale configuration requires at least one supported locale.");
  const canonical = configuration.supportedLocales.map((locale) => Intl.getCanonicalLocales(locale)[0]);
  if (new Set(canonical).size !== canonical.length) throw new Error("Locale configuration contains duplicate canonical locales.");
  if (!configuration.supportedLocales.includes(configuration.defaultLocale)) throw new Error("The default locale must be supported.");
  if (configuration.supportedLocales.length > 1 && !configuration.path && !configuration.domains) throw new Error("Multiple locales require a path or domain binding.");
}
