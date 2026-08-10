import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { renderDocument } from "../document";
import {
  loadNotFoundMatch,
  type LoadedNotFoundMatch,
  type RouteManifest,
} from "../router";
import type { NotFoundProps } from "../route";
import { BuiltInNotFound } from "./fallbacks";
import type { FailureSite } from "./failure-site";
import { prefersHtmlDocument } from "./negotiate";
import { createProblemResponse } from "./problem";
import type { SsrRenderOptions } from "./ssr";

export type NotFoundRenderOptions = SsrRenderOptions & {
  onError?: (error: unknown, site: FailureSite) => void;
  // Dev passes Vite's `transformIndexHtml` here so a framework-rendered
  // fallback document gets the same client entry and HMR wiring a page does.
  transformDocument?: (html: string) => string | Promise<string>;
};

export function createNotFoundProblemResponse(url: URL) {
  return createProblemResponse({
    instance: `${url.pathname}${url.search}`,
    status: 404,
    title: "Not Found",
  });
}

// The only place a 404 is produced. Both the unmatched-path case and the
// `notFound()` response capability route through here so an app cannot end up
// with two different 404 shapes.
export async function renderNotFoundResponse(
  manifest: RouteManifest,
  request: Request,
  options: NotFoundRenderOptions = {},
) {
  const url = new URL(request.url);

  if (!prefersHtmlDocument(request)) {
    return createNotFoundProblemResponse(url);
  }

  const match = await loadNotFoundMatch(manifest, url.pathname, {
    onLayoutError: (error) => options.onError?.(error, "page"),
  });
  const html = renderNotFoundDocument(match, options);

  return new Response(
    (await options.transformDocument?.(html)) ?? html,
    {
      headers: { "content-type": "text/html; charset=utf-8" },
      status: 404,
    },
  );
}

export function renderNotFoundDocument(
  match: LoadedNotFoundMatch,
  options: NotFoundRenderOptions = {},
) {
  const NotFound = match.notFound ?? BuiltInNotFound;

  // Three attempts, each one giving up a layer of app code. A layout resolved
  // for an unmatched path is the likeliest thing to throw here, and falling
  // back to the layout-free document beats escalating a 404 into a 500.
  try {
    return renderAttempt(match, NotFound, match.layouts, options);
  } catch (error) {
    options.onError?.(error, "page");
  }

  try {
    return renderAttempt(match, NotFound, [], options);
  } catch (error) {
    options.onError?.(error, "page");
  }

  return renderAttempt(match, BuiltInNotFound, [], options);
}

function renderAttempt(
  match: LoadedNotFoundMatch,
  NotFound: ComponentType<NotFoundProps>,
  layouts: LoadedNotFoundMatch["layouts"],
  options: NotFoundRenderOptions,
) {
  const content = layouts.reduceRight<ReactNode>(
    (children, Layout) =>
      createElement(Layout, {
        children,
        path: {},
        pathname: match.pathname,
      }),
    createElement(NotFound, { pathname: match.pathname }),
  );

  return renderDocument({
    body: {
      data: undefined,
      fallback: "not-found",
      html: renderToString(content),
    },
    entrySrc: options.clientEntry,
    lang: options.lang,
    metadata: match.metadata,
    nonce: options.nonce,
    styles: options.styles,
    title: options.title,
  });
}
