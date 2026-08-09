import {
  HYDRATION_DATA_ELEMENT_ID,
  HYDRATION_ROOT_ATTRIBUTE,
  serializeInitialRouteData,
} from "./hydration";
import type {
  DocumentMetadataTag,
  LinkTag,
  ResolvedMetadata,
  StructuredDataTag,
} from "./metadata";
import type { ScriptTag } from "./scripts";

export type DocumentBody = {
  data: unknown;
  html: string;
};

export type RenderDocumentOptions = {
  body?: DocumentBody;
  entrySrc?: string;
  lang?: string;
  links?: LinkTag[];
  metadata?: ResolvedMetadata;
  nonce?: string;
  scripts?: ScriptTag[];
  title?: string;
};

export function renderDocument({
  body,
  entrySrc,
  lang = "en",
  links = [],
  metadata,
  nonce,
  scripts = [],
  title = "Demiurge App",
}: RenderDocumentOptions) {
  const documentTitle = metadata?.title ?? title;
  const bodyContent = [
    renderRootElement(body),
    ...scripts.map((scriptTag) => `    ${renderScriptTag(scriptTag, nonce)}`),
    ...(body ? [renderBootstrapScript(body.data, nonce)] : []),
    ...(entrySrc ? [renderEntryScript(entrySrc, nonce)] : []),
  ].join("\n");

  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
  <head>
${renderHeadTags({ links, metadata, nonce, title: documentTitle })}
  </head>
  <body>
${bodyContent}
  </body>
</html>
`;
}

function renderRootElement(body: DocumentBody | undefined) {
  if (!body) {
    return `    <div id="root"></div>`;
  }

  return `    <div id="root" ${HYDRATION_ROOT_ATTRIBUTE}="">${body.html}</div>`;
}

function renderBootstrapScript(data: unknown, nonce: string | undefined) {
  return `    <script type="application/json" id="${HYDRATION_DATA_ELEMENT_ID}"${renderAttribute("nonce", nonce)}>${serializeInitialRouteData(data)}</script>`;
}

function renderEntryScript(entrySrc: string, nonce: string | undefined) {
  return `    <script type="module" src="${escapeHtml(entrySrc)}"${renderAttribute("nonce", nonce)}></script>`;
}

function renderHeadTags({
  links,
  metadata,
  nonce,
  title,
}: {
  links: LinkTag[];
  metadata: ResolvedMetadata | undefined;
  nonce: string | undefined;
  title: string;
}) {
  return [
    renderMetaTag({
      content: metadata?.charset ?? "UTF-8",
      kind: "meta",
      name: "charset",
    }),
    renderMetaTag({
      content: metadata?.viewport ?? "width=device-width, initial-scale=1.0",
      kind: "meta",
      name: "viewport",
    }),
    `    <title>${escapeHtml(title)}</title>`,
    ...(metadata?.description
      ? [
        renderMetaTag({
          content: metadata.description,
          kind: "meta",
          name: "description",
        }),
      ]
      : []),
    ...(metadata?.canonical
      ? [
        renderLinkTag({
          href: metadata.canonical,
          kind: "link",
          rel: "canonical",
        }),
      ]
      : []),
    ...renderRobotsTags(metadata),
    ...renderOpenGraphTags(metadata),
    ...(metadata?.custom ?? []).map(renderDocumentMetadataTag),
    ...(metadata?.structuredData ?? []).map((tag) =>
      renderStructuredDataTag(tag, nonce),
    ),
    ...links.map(renderLinkTag),
  ].join("\n");
}

function renderRobotsTags(metadata: ResolvedMetadata | undefined) {
  if (!metadata?.robots) {
    return [];
  }

  const directives = [
    metadata.robots.index === false ? "noindex" : "index",
    metadata.robots.follow === false ? "nofollow" : "follow",
  ];

  return [
    renderMetaTag({
      content: directives.join(", "),
      kind: "meta",
      name: "robots",
    }),
  ];
}

function renderOpenGraphTags(metadata: ResolvedMetadata | undefined) {
  if (!metadata?.openGraph) {
    return [];
  }

  return [
    metadata.openGraph.title
      ? renderMetaTag({
        content: metadata.openGraph.title,
        kind: "meta",
        property: "og:title",
      })
      : null,
    metadata.openGraph.description
      ? renderMetaTag({
        content: metadata.openGraph.description,
        kind: "meta",
        property: "og:description",
      })
      : null,
    metadata.openGraph.image
      ? renderMetaTag({
        content: metadata.openGraph.image,
        kind: "meta",
        property: "og:image",
      })
      : null,
  ].filter((tag): tag is string => Boolean(tag));
}

function renderDocumentMetadataTag(tag: DocumentMetadataTag) {
  if (tag.kind === "link") {
    return renderLinkTag(tag);
  }

  return renderMetaTag(tag);
}

function renderStructuredDataTag(
  tag: StructuredDataTag,
  nonce: string | undefined,
) {
  return `    <script type="application/ld+json"${renderAttribute("nonce", nonce)}>${escapeJsonScript(JSON.stringify(tag.value))}</script>`;
}

function renderMetaTag(tag: DocumentMetadataTag & { kind: "meta" }) {
  if (tag.name === "charset") {
    return `    <meta charset="${escapeHtml(tag.content)}" />`;
  }

  const name = tag.name ? ` name="${escapeHtml(tag.name)}"` : "";
  const property = tag.property ? ` property="${escapeHtml(tag.property)}"` : "";

  return `    <meta${name}${property} content="${escapeHtml(tag.content)}" />`;
}

function renderLinkTag(tag: LinkTag) {
  return `    <link${renderAttribute("rel", tag.rel)}${renderAttribute("href", tag.href)}${renderAttribute("as", tag.as)}${renderAttribute("type", tag.type)}${renderAttribute("crossorigin", tag.crossOrigin)}${renderAttribute("hreflang", tag.hrefLang)} />`;
}

function renderScriptTag(scriptTag: ScriptTag, nonce: string | undefined) {
  return `<script${renderAttribute("id", scriptTag.id)}${renderAttribute("src", scriptTag.src)}${renderAttribute("type", scriptTag.type ?? scriptTypeForStrategy(scriptTag.strategy))}${renderAttribute("nonce", scriptTag.nonce ?? nonce)}${renderAttribute("integrity", scriptTag.integrity)}${renderAttribute("referrerpolicy", scriptTag.referrerPolicy)}${renderAttribute("data-api", scriptTag.dataApi)}${renderAttribute("data-domain", scriptTag.dataDomain)}${renderBooleanAttribute("async", scriptTag.async)}${renderBooleanAttribute("defer", scriptTag.defer)}></script>`;
}

function scriptTypeForStrategy(strategy: ScriptTag["strategy"]) {
  return strategy === "module" ? "module" : undefined;
}

function renderAttribute(name: string, value: string | undefined) {
  return value ? ` ${name}="${escapeHtml(value)}"` : "";
}

function renderBooleanAttribute(name: string, value: boolean | undefined) {
  return value ? ` ${name}` : "";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeJsonScript(value: string) {
  return value
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029");
}
