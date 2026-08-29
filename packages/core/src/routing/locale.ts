export interface RouteLocales {}

type KnownLocale = keyof RouteLocales & string;
export type AppLocale = [KnownLocale] extends [never] ? string : KnownLocale;
export type LocaleSource = "path" | "domain" | "cookie" | "accept-language" | "default";

export type LocaleConfiguration<TLocale extends string = string> = {
  aliases?: Readonly<Record<string, TLocale>>;
  cookie?: { name: string };
  defaultLocale: TLocale;
  directions?: Partial<Readonly<Record<TLocale, "ltr" | "rtl">>>;
  domains?: Partial<Readonly<Record<TLocale, string>>>;
  path?: {
    labels: Readonly<Record<TLocale, string>>;
    prefixDefault?: boolean;
    reserved?: readonly string[];
  };
  resolver?: LocaleResolver<TLocale>;
  supportedLocales: readonly TLocale[];
  xDefault?: TLocale;
};

export type LocaleDirection = "ltr" | "rtl";

export type LocaleResolverInput<TLocale extends string = string> = {
  configuration: LocaleConfiguration<TLocale>;
  defaultResolution: LocaleResolution<TLocale>;
  request: Request;
};

export type LocaleResolver<TLocale extends string = string> = (
  input: LocaleResolverInput<TLocale>,
) => LocaleResolution<TLocale>;

export type LocaleResolution<TLocale extends string = string> = {
  locale: TLocale;
  pathname: string;
  redirect?: URL;
  source: LocaleSource;
  unsupported: boolean;
};

export function defineLocales<const TLocale extends string>(
  configuration: LocaleConfiguration<TLocale>,
): LocaleConfiguration<TLocale> {
  validateLocales(configuration);
  const canonical = new Map(
    configuration.supportedLocales.map((locale) => [locale, canonicalLocale(locale)]),
  );
  const normalizeTarget = (locale: string) => {
    const supported = configuration.supportedLocales.find((value) => value === locale);
    if (!supported) throw new Error(`The locale target "${locale}" must be supported.`);
    return canonical.get(supported) ?? supported;
  };
  const normalizedLabels = configuration.path && Object.fromEntries(
    configuration.supportedLocales.map((locale) => [
      canonicalLocale(locale),
      configuration.path?.labels[locale].toLowerCase(),
    ]),
  );
  // TYPE-EVIDENCE: the entries above include one normalized label for every TLocale value.
  const labels = normalizedLabels as Record<TLocale, string> | undefined;
  const normalizedDomains = configuration.domains && Object.fromEntries(
    configuration.supportedLocales.flatMap((locale) => {
      const domain = configuration.domains?.[locale];
      return domain ? [[canonicalLocale(locale), normalizeDomain(domain)]] : [];
    }),
  );
  // TYPE-EVIDENCE: each domain entry uses a supported TLocale value as its key.
  const domains = normalizedDomains as Partial<Record<TLocale, string>> | undefined;
  return {
    ...configuration,
    aliases: configuration.aliases && Object.fromEntries(
      Object.entries(configuration.aliases).map(([alias, locale]) => [alias.toLowerCase(), normalizeTarget(String(locale))]),
    ),
    defaultLocale: normalizeTarget(configuration.defaultLocale),
    // TYPE-EVIDENCE: validation restricts each direction key to a supported TLocale value.
    directions: configuration.directions && Object.fromEntries(
      Object.entries(configuration.directions).map(([locale, direction]) => [
        canonicalLocale(locale),
        direction,
      ]),
    ) as Partial<Record<TLocale, LocaleDirection>>,
    domains,
    path: configuration.path && {
      ...configuration.path,
      labels: labels!,
      reserved: configuration.path.reserved?.map((label) => label.toLowerCase()),
    },
    supportedLocales: configuration.supportedLocales.map(canonicalLocale),
    xDefault: configuration.xDefault && normalizeTarget(configuration.xDefault),
  };
}

export function localeDirection<TLocale extends string>(
  locale: TLocale,
  configuration?: LocaleConfiguration<TLocale>,
): LocaleDirection {
  const configured = configuration?.directions?.[locale];
  if (configured) return configured;

  const localeInformation = new Intl.Locale(locale);
  const direction = localeInformation.textInfo?.direction;
  if (direction) return direction;

  return rtlScripts.has(localeInformation.maximize().script ?? "") ? "rtl" : "ltr";
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
  const defaultResolution: LocaleResolution<TLocale> = {
    locale,
    pathname,
    redirect: !unsupported && canonical.href !== url.href ? canonical : undefined,
    source,
    unsupported,
  };
  const resolution = configuration.resolver?.({
    configuration,
    defaultResolution,
    request,
  }) ?? defaultResolution;

  if (!configuration.supportedLocales.includes(resolution.locale)) {
    throw new Error(
      `The locale resolver returned unsupported locale ${JSON.stringify(resolution.locale)}.`,
    );
  }

  if (
    resolution.redirect &&
    resolution.redirect.origin !== url.origin &&
    !Object.values(configuration.domains ?? {}).includes(resolution.redirect.hostname)
  ) {
    throw new Error("The locale resolver returned an external redirect.");
  }

  return resolution;
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
    const [tag = "", ...parameters] = part.trim().split(";");
    const quality = parameters.find((parameter) => parameter.trim().toLowerCase().startsWith("q="));
    const q = quality ? Number(quality.trim().slice(2)) : 1;
    return { order, q, tag: tag.trim() };
  }).filter(({ q, tag }) => tag !== "" && Number.isFinite(q) && q > 0 && q <= 1)
    .sort((a, b) => b.q - a.q || a.order - b.order);
  for (const value of values) {
    if (value.tag === "*") return configuration.defaultLocale;
    let candidate = value.tag.toLowerCase();
    while (candidate) {
      const match = configuration.supportedLocales.find((locale) => locale.toLowerCase() === candidate) ??
        configuration.supportedLocales.find((locale) => locale.toLowerCase().startsWith(`${candidate}-`));
      if (match) return match;
      const separator = candidate.lastIndexOf("-");
      if (separator < 0) break;
      candidate = candidate.slice(0, separator);
    }
  }
  return undefined;
}

function validateLocales<TLocale extends string>(configuration: LocaleConfiguration<TLocale>) {
  if (configuration.supportedLocales.length === 0) throw new Error("Locale configuration requires at least one supported locale.");
  const canonical = configuration.supportedLocales.map(canonicalLocale);
  if (new Set(canonical).size !== canonical.length) throw new Error("Locale configuration contains duplicate canonical locales.");
  if (!canonical.includes(canonicalLocale(configuration.defaultLocale))) throw new Error("The default locale must be supported.");
  if (configuration.supportedLocales.length > 1 && !configuration.path && !configuration.domains) throw new Error("Multiple locales require a path or domain binding.");
  const supported = new Set<string>(canonical);
  const assertTarget = (locale: string, kind: string) => {
    if (!supported.has(canonicalLocale(locale))) throw new Error(`The ${kind} target "${locale}" must be supported.`);
  };
  const identifiers = new Map<string, string>();
  const addIdentifier = (value: string, kind: string) => {
    const key = value.toLowerCase();
    const previous = identifiers.get(key);
    if (previous) throw new Error(`Locale ${kind} "${value}" conflicts with ${previous}.`);
    identifiers.set(key, `${kind} "${value}"`);
  };
  for (const [locale, label] of Object.entries(configuration.path?.labels ?? {})) {
    assertTarget(locale, "path label");
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(String(label))) throw new Error(`Locale path label "${label}" is invalid.`);
    addIdentifier(String(label), "path label");
  }
  for (const [alias, locale] of Object.entries(configuration.aliases ?? {})) {
    assertTarget(String(locale), "alias");
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(alias)) throw new Error(`Locale alias "${alias}" is invalid.`);
    addIdentifier(alias, "alias");
  }
  for (const value of configuration.path?.reserved ?? []) addIdentifier(value, "reserved label");
  const domains = new Set<string>();
  for (const [locale, domain] of Object.entries(configuration.domains ?? {})) {
    assertTarget(locale, "domain");
    const normalized = normalizeDomain(String(domain));
    if (domains.has(normalized)) throw new Error(`Locale domain "${domain}" is duplicated.`);
    domains.add(normalized);
  }
  for (const [locale, direction] of Object.entries(configuration.directions ?? {})) {
    assertTarget(locale, "direction");
    if (direction !== "ltr" && direction !== "rtl") {
      throw new Error(`Locale direction for "${locale}" must be "ltr" or "rtl".`);
    }
  }
  if (configuration.cookie && !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(configuration.cookie.name)) {
    throw new Error("The locale cookie name is invalid.");
  }
  if (configuration.xDefault) assertTarget(configuration.xDefault, "x-default");
}

function canonicalLocale<TLocale extends string>(locale: TLocale): TLocale {
  const [canonical] = Intl.getCanonicalLocales(locale);
  if (!canonical) throw new Error(`Locale "${locale}" is invalid.`);
  // TYPE-EVIDENCE: canonicalization changes spelling only. It preserves the locale represented by TLocale.
  return canonical as TLocale;
}

const rtlScripts = new Set([
  "Adlm",
  "Arab",
  "Armi",
  "Avst",
  "Chrs",
  "Cprt",
  "Elym",
  "Gara",
  "Hatr",
  "Hebr",
  "Hung",
  "Khar",
  "Lydi",
  "Mand",
  "Mani",
  "Mend",
  "Merc",
  "Mero",
  "Narb",
  "Nbat",
  "Nkoo",
  "Orkh",
  "Ougr",
  "Palm",
  "Phli",
  "Phlp",
  "Phnx",
  "Prti",
  "Rohg",
  "Samr",
  "Sarb",
  "Sidt",
  "Sogd",
  "Sogo",
  "Syrc",
  "Thaa",
  "Yezi",
]);

function normalizeDomain(domain: string) {
  if (domain.includes(":" ) || domain.includes("/") || domain.trim() !== domain) {
    throw new Error(`Locale domain "${domain}" must be a hostname.`);
  }
  const hostname = new URL(`https://${domain}`).hostname.toLowerCase();
  if (!hostname || hostname !== domain.toLowerCase()) throw new Error(`Locale domain "${domain}" must be a hostname.`);
  return hostname;
}
