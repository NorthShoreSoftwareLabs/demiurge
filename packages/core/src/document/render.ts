import {
  HYDRATION_DATA_ELEMENT_ID,
  HYDRATION_FALLBACK_ATTRIBUTE,
  HYDRATION_ROOT_ATTRIBUTE,
  serializeInitialRouteData,
} from "./hydration";
import type {
  DocumentMetadataTag,
  LinkTag,
  ResolvedMetadata,
  StructuredDataTag,
} from "./metadata";
import { scriptPlacement, type ScriptTag } from "./scripts";

export const STRUCTURED_DATA_ATTRIBUTE = "data-demiurge-structured-data";

export type DocumentBody = {
  data: unknown;
  fallback?: "not-found";
  html: string;
  navigation?: "document";
};

export type RenderDocumentOptions = {
  body?: DocumentBody;
  entrySrc?: string;
  lang?: string;
  links?: LinkTag[];
  metadata?: ResolvedMetadata;
  nonce?: string;
  scripts?: ScriptTag[];
  styles?: string[];
  title?: string;
};

export type RenderDocumentShellOptions = Omit<RenderDocumentOptions, "body"> & {
  body: Omit<DocumentBody, "html">;
};

export function renderDocument(options: RenderDocumentOptions) {
  if (options.body) {
    const { html, ...body } = options.body;
    const { prefix, suffix } = renderDocumentShell({ ...options, body });

    return `${prefix}${html}${suffix}`;
  }

  return renderDocumentWithoutBody(options);
}

export function renderDocumentShell({
  body,
  entrySrc,
  lang = "en",
  links = [],
  metadata,
  nonce,
  scripts = [],
  styles = [],
  title = "Demiurge App",
}: RenderDocumentShellOptions) {
  const documentTitle = metadata?.title ?? title;
  const trailingBodyContent = [
    ...scripts
      .filter((scriptTag) => scriptTag[scriptPlacement] !== "hoisted")
      .map((scriptTag) => `    ${renderScriptTag(scriptTag, nonce)}`),
    renderBootstrapData(body.data, body.navigation),
    ...(entrySrc ? [renderEntryScript(entrySrc, nonce)] : []),
  ].join("\n");

  return {
    prefix: `<!doctype html>
<html lang="${escapeHtml(lang)}">
  <head>
${renderHeadTags({ links, metadata, nonce, scripts, styles, title: documentTitle })}
  </head>
  <body>
${renderRootStart(body)}`,
    suffix: `</div>
${trailingBodyContent}
  </body>
</html>
`,
  };
}

function renderDocumentWithoutBody({
  entrySrc,
  lang = "en",
  links = [],
  metadata,
  nonce,
  scripts = [],
  styles = [],
  title = "Demiurge App",
}: RenderDocumentOptions) {
  const documentTitle = metadata?.title ?? title;
  const bodyContent = [
    renderRootElement(),
    ...scripts
      .filter((scriptTag) => scriptTag[scriptPlacement] !== "hoisted")
      .map((scriptTag) => `    ${renderScriptTag(scriptTag, nonce)}`),
    ...(entrySrc ? [renderEntryScript(entrySrc, nonce)] : []),
  ].join("\n");

  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
  <head>
${renderHeadTags({ links, metadata, nonce, scripts, styles, title: documentTitle })}
  </head>
  <body>
${bodyContent}
  </body>
</html>
`;
}

function renderRootElement(body?: DocumentBody) {
  if (!body) {
    return `    <div id="root"></div>`;
  }

  return `${renderRootStart(body)}${body.html}</div>`;
}

function renderRootStart(body: Omit<DocumentBody, "html">) {
  const fallback = body.fallback
    ? ` ${HYDRATION_FALLBACK_ATTRIBUTE}="${escapeHtml(body.fallback)}"`
    : "";

  return `    <div id="root" ${HYDRATION_ROOT_ATTRIBUTE}=""${fallback}>`;
}

function renderBootstrapData(data: unknown, navigation?: "document") {
  return `    <template id="${HYDRATION_DATA_ELEMENT_ID}">${serializeInitialRouteData(data, { navigation })}</template>`;
}

function renderEntryScript(entrySrc: string, nonce: string | undefined) {
  return `    <script type="module" src="${escapeHtml(entrySrc)}"${renderAttribute("nonce", nonce)}></script>`;
}

function renderHeadTags({
  links,
  metadata,
  nonce,
  scripts,
  styles,
  title,
}: {
  links: LinkTag[];
  metadata: ResolvedMetadata | undefined;
  nonce: string | undefined;
  scripts: ScriptTag[];
  styles: string[];
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
    ...styles.map(
      (href) => `    <link rel="stylesheet" href="${escapeHtml(href)}" />`,
    ),
    ...links.map(renderLinkTag),
    ...scripts
      .filter((scriptTag) => scriptTag[scriptPlacement] === "hoisted")
      .map((scriptTag) => `    ${renderScriptTag(scriptTag, nonce)}`),
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
  const ownership = nonce ? "" : ` ${STRUCTURED_DATA_ATTRIBUTE}`;

  return `    <script type="application/ld+json"${ownership}${renderAttribute("nonce", nonce)}>${escapeJsonScript(JSON.stringify(tag.value))}</script>`;
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
  return `<script${renderAttribute("id", scriptTag.id)}${renderAttribute("src", scriptTag.src)}${renderAttribute("type", scriptTag.type ?? scriptTypeForStrategy(scriptTag.strategy))}${renderAttribute("nonce", scriptTag.nonce ?? nonce)}${renderAttribute("integrity", scriptTag.integrity)}${renderAttribute("referrerpolicy", scriptTag.referrerPolicy)}${renderAttribute("data-api", scriptTag.dataApi)}${renderAttribute("data-domain", scriptTag.dataDomain)}${renderAttribute("data-demiurge-script-placement", scriptTag[scriptPlacement])}${renderBooleanAttribute("async", scriptTag.async)}${renderBooleanAttribute("defer", scriptTag.defer)}></script>`;
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
