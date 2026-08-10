import { renderToString } from "react-dom/server";
import { renderDocument } from "../document";
import type { LoadedRouteMatch } from "../router";
import { createPageRenderTree } from "./render-tree";

export type SsrOptions = {
  clientEntry?: string;
  lang?: string;
  styles?: string[];
  title?: string;
};

export type SsrRenderOptions = SsrOptions & {
  nonce?: string;
  onStreamError?: (error: unknown) => void;
  signal?: AbortSignal;
  transformDocument?: (html: string) => string | Promise<string>;
};

export function renderPageDocument(
  match: LoadedRouteMatch,
  options: SsrRenderOptions = {},
) {
  const html = renderToString(createPageRenderTree(match));

  return renderDocument({
    body: { data: match.data, html },
    entrySrc: options.clientEntry,
    lang: options.lang,
    links: match.links,
    metadata: match.metadata,
    nonce: options.nonce,
    scripts: match.scripts,
    styles: options.styles,
    title: options.title,
  });
}

export function renderPageResponse(
  match: LoadedRouteMatch,
  options: SsrRenderOptions = {},
) {
  const html = renderPageDocument(match, options);

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });
}
