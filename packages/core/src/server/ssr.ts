import { renderToString } from "react-dom/server";
import { renderDocument } from "../document";
import { localeDirection } from "../routing";
import type { LoadedRouteMatch } from "../router";
import { createPageRenderTree, createPageScriptContext } from "./render-tree";

export type SsrOptions = {
  clientEntry?: string;
  dir?: "ltr" | "rtl";
  lang?: string;
  locale?: string;
  navigation?: "document";
  styles?: string[];
  title?: string;
};

export type SsrRenderOptions = SsrOptions & {
  dev?: boolean;
  nonce?: string;
  onStreamError?: (error: unknown) => void;
  signal?: AbortSignal;
  transformDocument?: (html: string) => string | Promise<string>;
};

export function resolveDocumentLocale(options: SsrOptions) {
  return {
    dir: options.dir ?? (options.locale ? localeDirection(options.locale) : undefined),
    lang: options.lang ?? options.locale,
  };
}

export function renderPageDocument(
  match: LoadedRouteMatch,
  options: SsrRenderOptions = {},
) {
  const documentLocale = resolveDocumentLocale(options);
  const scripts = createPageScriptContext(match, options);
  const html = renderToString(createPageRenderTree(match, scripts));

  return renderDocument({
    body: {
      data: match.data,
      html,
      locale: options.locale,
      navigation: match.render.mode === "static"
        ? "document"
        : options.navigation,
    },
    entrySrc: options.clientEntry,
    dir: documentLocale.dir,
    lang: documentLocale.lang,
    links: match.links,
    metadata: match.metadata,
    nonce: options.nonce,
    scripts: scripts.scripts(),
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
