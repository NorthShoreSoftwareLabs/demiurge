import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { renderDocument } from "../document";
import type { LoadedRouteMatch } from "../router";

export type SsrOptions = {
  clientEntry?: string;
  lang?: string;
  title?: string;
};

export type SsrRenderOptions = SsrOptions & {
  nonce?: string;
};

export function renderPageDocument(
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
  const html = renderToString(content);

  return renderDocument({
    body: { data: match.data, html },
    entrySrc: options.clientEntry,
    lang: options.lang,
    links: match.links,
    metadata: match.metadata,
    nonce: options.nonce,
    scripts: match.scripts,
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
