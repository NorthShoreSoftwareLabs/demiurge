import {
  DEFERRED_SCRIPT_ATTRIBUTE,
  DEFERRED_SCRIPT_SRC_ATTRIBUTE,
  DEFERRED_SCRIPT_TYPE,
  DEFERRED_SCRIPT_TYPE_ATTRIBUTE,
  isDeferredScriptStrategy,
  startDeferredScripts,
} from "./deferred-scripts";
import type { LinkTag, ResolvedMetadata } from "./metadata";
import type { ScriptStrategy, ScriptTag } from "./scripts";
import { createFrameworkScriptUrl } from "./trusted-types";

export const DOCUMENT_CONTRIBUTION_ATTRIBUTE =
  "data-demiurge-document-contribution";
export const DOCUMENT_SCRIPT_STRATEGY_ATTRIBUTE =
  "data-demiurge-script-strategy";

export type NavigationScriptTag = Pick<
  ScriptTag,
  | "async"
  | "crossOrigin"
  | "dataApi"
  | "dataDomain"
  | "defer"
  | "id"
  | "integrity"
  | "kind"
  | "referrerPolicy"
  | "src"
  | "strategy"
  | "type"
>;

export type NavigationDocument = {
  links: LinkTag[];
  metadata: ResolvedMetadata;
  scripts: NavigationScriptTag[];
  title: string;
};

export function createNavigationDocument(options: {
  links?: readonly LinkTag[];
  metadata: ResolvedMetadata;
  scripts?: readonly ScriptTag[];
  title?: string;
}): NavigationDocument {
  return {
    links: [...(options.links ?? [])],
    metadata: options.metadata,
    scripts: (options.scripts ?? []).map(toNavigationScriptTag),
    title: options.metadata.title ?? options.title ?? "Demiurge App",
  };
}

function toNavigationScriptTag(script: ScriptTag): NavigationScriptTag {
  return {
    async: script.async,
    crossOrigin: script.crossOrigin,
    dataApi: script.dataApi,
    dataDomain: script.dataDomain,
    defer: script.defer,
    id: script.id,
    integrity: script.integrity,
    kind: "script",
    referrerPolicy: script.referrerPolicy,
    src: script.src,
    strategy: script.strategy,
    type: script.type,
  };
}

export function applyNavigationDocument(
  contribution: NavigationDocument,
  target?: Document,
) {
  const owner = target ?? (typeof document === "undefined" ? undefined : document);

  if (!owner) {
    return;
  }

  owner.title = contribution.title;
  reconcileManagedScripts(owner, contribution.scripts);

  for (const element of owner.head.querySelectorAll(
    `[${DOCUMENT_CONTRIBUTION_ATTRIBUTE}]:not(script)`,
  )) {
    element.remove();
  }

  appendMetadata(owner, contribution.metadata);

  for (const link of contribution.links) {
    owner.head.append(createLinkElement(owner, link));
  }

  startDeferredScripts(owner);
}

function appendMetadata(owner: Document, metadata: ResolvedMetadata) {
  if (metadata.description) {
    owner.head.append(createMetaElement(owner, {
      content: metadata.description,
      name: "description",
    }));
  }

  if (metadata.canonical) {
    owner.head.append(createLinkElement(owner, {
      href: metadata.canonical,
      kind: "link",
      rel: "canonical",
    }));
  }

  if (metadata.robots) {
    owner.head.append(createMetaElement(owner, {
      content: [
        metadata.robots.index === false ? "noindex" : "index",
        metadata.robots.follow === false ? "nofollow" : "follow",
      ].join(", "),
      name: "robots",
    }));
  }

  const openGraph = metadata.openGraph;
  for (const [property, content] of [
    ["og:title", openGraph?.title],
    ["og:description", openGraph?.description],
    ["og:image", openGraph?.image],
  ] as const) {
    if (content) {
      owner.head.append(createMetaElement(owner, { content, property }));
    }
  }

  for (const tag of metadata.custom) {
    owner.head.append(
      tag.kind === "link"
        ? createLinkElement(owner, tag)
        : createMetaElement(owner, tag),
    );
  }

  for (const tag of metadata.structuredData) {
    const element = owner.createElement("script");
    element.type = "application/ld+json";
    element.textContent = JSON.stringify(tag.value);
    markContribution(element);
    applyDocumentNonce(element, owner);
    owner.head.append(element);
  }
}

function createMetaElement(
  owner: Document,
  tag: { content: string; name?: string; property?: string },
) {
  const element = owner.createElement("meta");
  element.content = tag.content;
  if (tag.name) element.name = tag.name;
  if (tag.property) element.setAttribute("property", tag.property);
  markContribution(element);
  return element;
}

function createLinkElement(owner: Document, tag: LinkTag) {
  const element = owner.createElement("link");
  element.rel = tag.rel;
  element.href = tag.href;
  if (tag.as) element.as = tag.as;
  if (tag.type) element.type = tag.type;
  if (tag.crossOrigin) element.crossOrigin = tag.crossOrigin;
  if (tag.hrefLang) element.hreflang = tag.hrefLang;
  markContribution(element);
  return element;
}

function reconcileManagedScripts(
  owner: Document,
  scripts: readonly NavigationScriptTag[],
) {
  const existing = new Map<string, HTMLScriptElement>();

  for (const element of owner.querySelectorAll<HTMLScriptElement>(
    `script[${DOCUMENT_CONTRIBUTION_ATTRIBUTE}]`,
  )) {
    existing.set(scriptElementKey(element), element);
  }

  for (const script of scripts) {
    const key = scriptKey(script);
    if (existing.delete(key)) continue;

    owner.head.append(createScriptElement(owner, script));
  }

  for (const element of existing.values()) {
    element.remove();
  }
}

function createScriptElement(owner: Document, script: NavigationScriptTag) {
  const element = owner.createElement("script");
  markContribution(element);
  element.setAttribute(DOCUMENT_SCRIPT_STRATEGY_ATTRIBUTE, script.strategy);
  applyDocumentNonce(element, owner);

  if (script.id) element.id = script.id;
  if (script.integrity) element.integrity = script.integrity;
  if (script.crossOrigin) element.crossOrigin = script.crossOrigin;
  if (script.referrerPolicy) element.referrerPolicy = script.referrerPolicy;
  if (script.dataApi) element.dataset.api = script.dataApi;
  if (script.dataDomain) element.dataset.domain = script.dataDomain;

  if (isDeferredScriptStrategy(script.strategy)) {
    element.type = DEFERRED_SCRIPT_TYPE;
    element.setAttribute(DEFERRED_SCRIPT_ATTRIBUTE, script.strategy);
    element.setAttribute(DEFERRED_SCRIPT_SRC_ATTRIBUTE, script.src);
    if (script.type) {
      element.setAttribute(DEFERRED_SCRIPT_TYPE_ATTRIBUTE, script.type);
    }
    return element;
  }

  element.async = script.async ?? false;
  element.defer = script.defer ?? false;
  element.type = script.type ?? scriptTypeForStrategy(script.strategy);
  element.src = createFrameworkScriptUrl(owner.defaultView, script.src);
  return element;
}

function applyDocumentNonce(element: HTMLScriptElement, owner: Document) {
  const nonce = [...owner.scripts].reverse().find((script) => script.nonce)?.nonce;
  if (nonce) element.nonce = nonce;
}

function markContribution(element: Element) {
  element.setAttribute(DOCUMENT_CONTRIBUTION_ATTRIBUTE, "");
}

function scriptElementKey(element: HTMLScriptElement) {
  const strategy = element.getAttribute(DOCUMENT_SCRIPT_STRATEGY_ATTRIBUTE) ??
    element.getAttribute(DEFERRED_SCRIPT_ATTRIBUTE) ??
    inferScriptStrategy(element);
  const src = element.getAttribute(DEFERRED_SCRIPT_SRC_ATTRIBUTE) ??
    element.getAttribute("src") ?? "";
  return [src, element.getAttribute("type") ?? "", element.integrity, strategy]
    .join("\0");
}

function scriptKey(script: NavigationScriptTag) {
  const type = isDeferredScriptStrategy(script.strategy)
    ? DEFERRED_SCRIPT_TYPE
    : script.type ?? scriptTypeForStrategy(script.strategy);
  return [script.src, type, script.integrity ?? "", script.strategy].join("\0");
}

function inferScriptStrategy(element: HTMLScriptElement): ScriptStrategy {
  if (element.type === "module") return "module";
  return "afterInteractive";
}

function scriptTypeForStrategy(strategy: ScriptStrategy) {
  return strategy === "module" ? "module" : "";
}
