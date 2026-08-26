import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { createNavigationDocument, renderDocument } from "../document";
import { createScriptRenderContext, withScriptContext } from "../document/scripts";
import {
  findPoliciesForPath,
  createNavigationDataResponse,
  isNavigationDataRequest,
  loadNotFoundMatch,
  NAVIGATION_NOT_FOUND_RESPONSE,
  type LoadedNotFoundMatch,
  type RouteManifest,
} from "../router";
import type { NotFoundProps } from "../route";
import { createSecurityHeaders, mergeRoutePolicies } from "../security";
import {
  createCspNonce,
  securityPolicyRequiresNonce,
} from "../security/policy";
import { BuiltInNotFound } from "./fallbacks";
import type { FailureSite } from "./failure-site";
import { prefersHtmlDocument } from "./negotiate";
import { createProblemResponse } from "./problem";
import type { SsrRenderOptions } from "./ssr";

export type NotFoundRenderOptions = SsrRenderOptions & {
  onError?: (error: unknown, site: FailureSite) => void;
  pathname?: string;
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
  const pathname = options.pathname ?? url.pathname;

  if (!isNavigationDataRequest(request) && !prefersHtmlDocument(request)) {
    return createNotFoundProblemResponse(url);
  }

  const match = await loadNotFoundMatch(manifest, pathname, {
    locale: options.locale,
    onLayoutError: (error) => options.onError?.(error, "page"),
  });
  const documentPolicy = await loadDocumentPolicy(manifest, pathname);
  const nonce = options.nonce ?? (
    securityPolicyRequiresNonce(documentPolicy) ? createCspNonce() : undefined
  );
  const headers = createSecurityHeaders(documentPolicy ?? {}, {
    nonce,
    request,
  });

  if (isNavigationDataRequest(request)) {
    return createNavigationDataResponse(undefined, {
      document: createNavigationDocument({
        metadata: match.metadata,
        title: options.title,
      }),
      locale: options.locale,
      headers,
      kind: NAVIGATION_NOT_FOUND_RESPONSE,
      status: 404,
    });
  }

  const html = renderNotFoundDocument(match, { ...options, nonce });
  headers.set("content-type", "text/html; charset=utf-8");

  return new Response(
    (await options.transformDocument?.(html)) ?? html,
    {
      headers,
      status: 404,
    },
  );
}

async function loadDocumentPolicy(
  manifest: RouteManifest,
  pathname: string,
) {
  const modules = await Promise.all(
    findPoliciesForPath(manifest, pathname).map((policy) => policy.load()),
  );

  return mergeRoutePolicies(...modules.map((module) => module.policy)).document;
}

export function renderNotFoundDocument(
  match: LoadedNotFoundMatch,
  options: NotFoundRenderOptions = {},
) {
  const NotFound = match.notFound ?? BuiltInNotFound;

  // Three attempts remove one application layer at a time. A layout for an
  // unmatched path can cause an error. The layout-free document prevents this
  // error from changing a 404 response to a 500 response.
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
        locale: match.locale,
        path: {},
        pathname: match.pathname,
      }),
    createElement(NotFound, { locale: match.locale, pathname: match.pathname }),
  );
  const scripts = createScriptRenderContext({
    dev: options.dev,
    nonce: options.nonce,
  });

  return renderDocument({
    body: {
      data: undefined,
      fallback: "not-found",
      html: renderToString(withScriptContext(scripts, content)),
      locale: options.locale,
      navigation: options.navigation,
    },
    entrySrc: options.clientEntry,
    lang: options.lang,
    metadata: match.metadata,
    nonce: options.nonce,
    scripts: scripts.scripts(),
    styles: options.styles,
    title: options.title,
  });
}
