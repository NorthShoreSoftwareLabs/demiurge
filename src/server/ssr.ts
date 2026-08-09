import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import {
  HYDRATION_DATA_ELEMENT_ID,
  HYDRATION_ROOT_ATTRIBUTE,
  serializeInitialRouteData,
} from "../document";
import type { LoadedRouteMatch } from "../router";

export type SsrOptions = {
  clientEntry?: string;
  lang?: string;
  title?: string;
};

export type SsrRenderOptions = SsrOptions & {
  nonce?: string;
};

export function renderPageResponse(
  match: LoadedRouteMatch,
  options: SsrRenderOptions = {},
) {
  const page = createElement(match.page, {
    data: match.data,
    path: match.path,
    pathname: match.pathname,
  });
  const content = match.layouts.reduceRight<ReactNode>(
    (children, Layout) =>
      createElement(Layout, {
        children,
        path: match.path,
        pathname: match.pathname,
      }),
    page,
  );
  const body = renderToString(content);
  const html = renderDocument({
    body,
    data: match.data,
    clientEntry: options.clientEntry,
    lang: options.lang,
    links: match.links,
    metadata: match.metadata,
    nonce: options.nonce,
    scripts: match.scripts,
    title: options.title,
  });

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });
}

function renderDocument({
  body,
  clientEntry,
  data,
  lang = "en",
  links,
  metadata,
  nonce,
  scripts,
  title = "Demiurge App",
}: SsrRenderOptions & {
  body: string;
  data: unknown;
  links: LoadedRouteMatch["links"];
  metadata: LoadedRouteMatch["metadata"];
  scripts: LoadedRouteMatch["scripts"];
}) {
  const documentTitle = metadata.title ?? title;
  const head = [
    `<meta charset="utf-8" />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `<title>${escapeHtml(documentTitle)}</title>`,
    metadata.description
      ? `<meta name="description" content="${escapeHtml(metadata.description)}" />`
      : "",
    ...links.map(
      (link) =>
        `<link rel="${escapeHtml(link.rel)}" href="${escapeHtml(link.href)}"${attribute("as", link.as)}${attribute("type", link.type)}${attribute("crossorigin", link.crossOrigin)} />`,
    ),
    ...scripts.map((scriptTag) =>
      `<script src="${escapeHtml(scriptTag.src)}"${attribute("type", scriptTag.type)}${attribute("nonce", scriptTag.nonce ?? nonce)}${attribute("integrity", scriptTag.integrity)}${attribute("data-api", scriptTag.dataApi)}${attribute("data-domain", scriptTag.dataDomain)}${booleanAttribute("async", scriptTag.async)}${booleanAttribute("defer", scriptTag.defer)}></script>`,
    ),
  ].filter(Boolean);

  const entry = clientEntry
    ? `<script type="module" src="${escapeHtml(clientEntry)}"${attribute("nonce", nonce)}></script>`
    : "";
  const bootstrap = `<script type="application/json" id="${HYDRATION_DATA_ELEMENT_ID}"${attribute("nonce", nonce)}>${serializeInitialRouteData(data)}</script>`;

  return `<!doctype html>\n<html lang="${escapeHtml(lang)}">\n  <head>\n    ${head.join("\n    ")}\n  </head>\n  <body>\n    <div id="root" ${HYDRATION_ROOT_ATTRIBUTE}="">${body}</div>\n    ${bootstrap}\n    ${entry}\n  </body>\n</html>\n`;
}

function attribute(name: string, value: string | undefined) {
  return value ? ` ${name}="${escapeHtml(value)}"` : "";
}

function booleanAttribute(name: string, value: boolean | undefined) {
  return value ? ` ${name}` : "";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "'": "&#39;",
      "\"": "&quot;",
      "<": "&lt;",
      ">": "&gt;",
    };

    return entities[character];
  });
}
