import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import {
  createNavigationDocument,
  renderDocument,
  resolveMetadata,
} from "../document";
import { createScriptRenderContext, withScriptContext } from "../document/scripts";
import {
  createNavigationDataResponse,
  isNavigationDataRequest,
  loadErrorFallback,
  NAVIGATION_ERROR_RESPONSE,
  type RouteManifest,
} from "../router";
import type { RouteErrorProps } from "../route";
import { isHttpError, type HttpErrorStatus } from "../route/http-error";
import { BuiltInError, DevError, describeError } from "./fallbacks";
import type { FailureSite } from "./failure-site";
import { prefersHtmlDocument } from "./negotiate";
import { createProblemResponse } from "./problem";
import type { SsrRenderOptions } from "./ssr";

export type ErrorRenderOptions = SsrRenderOptions & {
  dev?: boolean;
  onError?: (error: unknown, site: FailureSite) => void;
  transformDocument?: (html: string) => string | Promise<string>;
};

const PLAIN_TEXT_ERROR = "Internal Server Error";

// The build mode controls development output. An application option cannot
// control it. This second control prevents stack traces in a production process.
export function isDevErrorRendering(dev: boolean | undefined) {
  return dev === true && process.env.NODE_ENV !== "production";
}

export async function renderFailureResponse(
  manifest: RouteManifest,
  request: Request,
  error: unknown,
  site: FailureSite,
  options: ErrorRenderOptions = {},
) {
  options.onError?.(error, site);

  const url = new URL(request.url);

  // An API route never gets HTML. A page render already committed to a
  // document. Middleware and policy run before either is decided, so they
  // negotiate the same way an unmatched path does.
  const wantsDocument =
    isNavigationDataRequest(request) ||
    site === "page" ||
    (site === "middleware" && prefersHtmlDocument(request));

  if (!wantsDocument) {
    return createErrorProblemResponse(url, error, options);
  }

  if (isNavigationDataRequest(request)) {
    const described = describeError(error);
    const headers = isHttpError(error)
      ? new Headers(error.headers)
      : new Headers();

    return createNavigationDataResponse(undefined, {
      document: createNavigationDocument({
        metadata: resolveMetadata(),
        title: options.title,
      }),
      locale: options.locale,
      error: {
        detail: isHttpError(error)
          ? error.detail
          : isDevErrorRendering(options.dev) ? described.message : undefined,
        title: isHttpError(error) ? error.title : "Internal Server Error",
      },
      headers,
      kind: NAVIGATION_ERROR_RESPONSE,
      status: errorStatus(error),
    });
  }

  return await renderErrorDocumentResponse(manifest, url, error, options);
}

export function createErrorProblemResponse(
  url: URL,
  error: unknown,
  options: ErrorRenderOptions = {},
) {
  if (isHttpError(error)) {
    return createProblemResponse(
      {
        ...error.extensions,
        detail: error.detail,
        instance: `${url.pathname}${url.search}`,
        status: error.status,
        title: error.title,
        type: error.type,
      },
      { headers: error.headers },
    );
  }

  const { message } = describeError(error);

  return createProblemResponse({
    // `detail` carries the thrown message, so it is dev only for the same
    // reason the stack is.
    ...(isDevErrorRendering(options.dev) ? { detail: message } : {}),
    instance: `${url.pathname}${url.search}`,
    status: 500,
    title: "Internal Server Error",
  });
}

async function renderErrorDocumentResponse(
  manifest: RouteManifest,
  url: URL,
  error: unknown,
  options: ErrorRenderOptions,
) {
  const status = errorStatus(error);

  try {
    const html = await renderErrorDocument(
      manifest,
      url.pathname,
      error,
      options,
    );

    const headers = isHttpError(error)
      ? new Headers(error.headers)
      : new Headers();
    headers.set("content-type", "text/html; charset=utf-8");

    return new Response((await options.transformDocument?.(html)) ?? html, {
      headers,
      status,
    });
  } catch (renderError) {
    // Error page rendering is the final attempt. After the error path fails, the
    // framework cannot trust the application path again in the same request.
    // The response uses plain text and does not run application code again.
    options.onError?.(renderError, "page");

    return createPlainTextErrorResponse();
  }
}

export function createPlainTextErrorResponse() {
  return new Response(PLAIN_TEXT_ERROR, {
    headers: { "content-type": "text/plain; charset=utf-8" },
    status: 500,
  });
}

async function renderErrorDocument(
  manifest: RouteManifest,
  pathname: string,
  error: unknown,
  options: ErrorRenderOptions,
) {
  const Error = await resolveErrorComponent(manifest, pathname, options);
  const scripts = createScriptRenderContext({
    dev: options.dev,
    nonce: options.nonce,
  });
  const html = renderToString(
    withScriptContext(
      scripts,
      createElement(Error, { error, pathname, status: errorStatus(error) }),
    ),
  );

  return renderDocument({
    body: { data: undefined, html, locale: options.locale, navigation: options.navigation },
    entrySrc: options.clientEntry,
    lang: options.lang,
    nonce: options.nonce,
    scripts: scripts.scripts(),
    styles: options.styles,
    title: options.title,
  });
}

function errorStatus(error: unknown): HttpErrorStatus {
  return isHttpError(error) ? error.status : 500;
}

async function resolveErrorComponent(
  manifest: RouteManifest,
  pathname: string,
  options: ErrorRenderOptions,
): Promise<ComponentType<RouteErrorProps>> {
  // In dev the stack is the whole point, so the framework document wins over
  // the app's `@error.tsx`. Production never sees it.
  if (isDevErrorRendering(options.dev)) {
    return DevError;
  }

  try {
    return (await loadErrorFallback(manifest, pathname)) ?? BuiltInError;
  } catch {
    return BuiltInError;
  }
}
