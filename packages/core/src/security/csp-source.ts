import type {
  ContentSecurityPolicy,
  CspSource,
  CspSourceDirective,
} from "./types";

type CspSourceDirectiveName =
  | "defaultSrc"
  | "scriptSrc"
  | "scriptSrcElem"
  | "styleSrc"
  | "styleSrcElem"
  | "fontSrc";

export function getEffectiveCspSources(
  policy: ContentSecurityPolicy,
  directives: readonly CspSourceDirectiveName[],
) {
  for (const directive of directives) {
    const sources = resolveCspSourceDirective(policy[directive]);

    if (sources) {
      return { directive, sources };
    }
  }

  return undefined;
}

export function resolveCspSourceDirective(
  value: CspSourceDirective | undefined,
) {
  if (!value) {
    return undefined;
  }

  return "replace" in value ? value.replace : value;
}

export function cspSourceListAllowsResource(
  sources: readonly CspSource[],
  resource: string,
  origin?: string,
) {
  if (sources.includes("'none'")) {
    return false;
  }

  const resourceUrl = parseResourceUrl(resource, origin);

  return sources.some((source) =>
    cspSourceAllowsResource(source, resource, resourceUrl, origin)
  );
}

export function cspScriptSourceListAllowsResource(
  sources: readonly CspSource[],
  resource: string,
  origin?: string,
) {
  if (isStrictDynamicActive(sources)) {
    return false;
  }

  return cspSourceListAllowsResource(sources, resource, origin);
}

function cspSourceAllowsResource(
  source: CspSource,
  resource: string,
  resourceUrl: URL | undefined,
  origin: string | undefined,
) {
  if (source === "'self'") {
    if (isRelativeResource(resource)) {
      return true;
    }

    const originUrl = parseUrl(origin);
    return Boolean(
      originUrl && resourceUrl &&
        originUrl.hostname === resourceUrl.hostname &&
        portMatches(originUrl.port || undefined, resourceUrl) &&
        schemeMatches(originUrl.protocol.slice(0, -1), resourceUrl.protocol.slice(0, -1)),
    );
  }

  if (source.startsWith("'")) {
    return false;
  }

  if (!resourceUrl) {
    return false;
  }

  if (source === "*") {
    const originUrl = parseUrl(origin);
    return resourceUrl.protocol === "http:" || resourceUrl.protocol === "https:" ||
      originUrl?.protocol === resourceUrl.protocol;
  }

  if (isSchemeSource(source)) {
    return schemeMatches(source.slice(0, -1), resourceUrl.protocol.slice(0, -1));
  }

  const parsed = parseHostSource(source);
  if (!parsed) {
    return false;
  }

  const sourceScheme = parsed.scheme ??
    parseUrl(origin)?.protocol.slice(0, -1) ??
    inheritedHttpScheme(resourceUrl);
  if (!sourceScheme || !schemeMatches(sourceScheme, resourceUrl.protocol.slice(0, -1))) {
    return false;
  }

  return hostMatches(parsed.host, resourceUrl.hostname) &&
    portMatches(parsed.port, resourceUrl) &&
    pathMatches(parsed.path, resourceUrl.pathname);
}

function parseResourceUrl(resource: string, origin: string | undefined) {
  if (isSameOriginPath(resource) && origin) {
    return parseUrl(resource, origin);
  }

  return parseUrl(resource);
}

function parseUrl(value: string | undefined, base?: string) {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value, base);
  } catch {
    return undefined;
  }
}

function isSameOriginPath(resource: string) {
  return resource.startsWith("/") && !resource.startsWith("//");
}

function isRelativeResource(resource: string) {
  return !resource.startsWith("//") && !/^[a-z][a-z\d+.-]*:/i.test(resource);
}

function inheritedHttpScheme(resource: URL) {
  return resource.protocol === "http:" || resource.protocol === "https:"
    ? resource.protocol.slice(0, -1)
    : undefined;
}

function isSchemeSource(source: string) {
  return /^[a-z][a-z\d+.-]*:$/i.test(source);
}

function schemeMatches(source: string, resource: string) {
  const normalizedSource = source.toLowerCase();
  const normalizedResource = resource.toLowerCase();

  return normalizedSource === normalizedResource ||
    (normalizedSource === "http" && normalizedResource === "https") ||
    (normalizedSource === "ws" && ["wss", "http", "https"].includes(normalizedResource)) ||
    (normalizedSource === "wss" && normalizedResource === "https");
}

function parseHostSource(source: string) {
  const match = /^(?:([a-z][a-z\d+.-]*):\/\/)?(\*|\*\.[a-z\d.-]+|[a-z\d.-]+)(?::(\*|\d+))?(\/[^?#]*)?$/i.exec(
    source,
  );

  if (!match) {
    return undefined;
  }

  return {
    host: match[2]!,
    path: match[4] ?? "",
    port: match[3],
    scheme: match[1],
  };
}

function hostMatches(source: string, resource: string) {
  const normalizedSource = source.toLowerCase();
  const normalizedResource = resource.toLowerCase();

  if (normalizedSource === "*") {
    return true;
  }

  if (normalizedSource.startsWith("*.")) {
    return normalizedResource.endsWith(normalizedSource.slice(1));
  }

  return normalizedSource === normalizedResource;
}

function portMatches(source: string | undefined, resource: URL) {
  if (source === "*") {
    return true;
  }

  const resourcePort = resource.port || defaultPort(resource.protocol);
  const sourcePort = source ?? defaultPort(resource.protocol);
  return sourcePort === resourcePort;
}

function defaultPort(protocol: string) {
  if (protocol === "http:" || protocol === "ws:") {
    return "80";
  }

  if (protocol === "https:" || protocol === "wss:") {
    return "443";
  }

  return "";
}

function pathMatches(source: string, resource: string) {
  if (!source) {
    return true;
  }

  const sourceParts = source.split("/").map(decodePathPart);
  const resourceParts = resource.split("/").map(decodePathPart);
  const exact = !source.endsWith("/");

  if (exact && sourceParts.length !== resourceParts.length) {
    return false;
  }

  const comparedLength = exact ? sourceParts.length : sourceParts.length - 1;
  return sourceParts.slice(0, comparedLength).every(
    (part, index) => part === resourceParts[index],
  );
}

function decodePathPart(part: string) {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

function isStrictDynamicActive(sources: readonly CspSource[]) {
  return sources.includes("'strict-dynamic'") && sources.some((source) =>
    source.startsWith("'nonce-") || /^'sha(?:256|384|512)-/.test(source)
  );
}
