import { createElement, type ReactNode } from "react";
import {
  createScriptRenderContext,
  withScriptContext,
  type ScriptRenderContext,
} from "../document/scripts";
import type { LoadedRouteMatch } from "../router";

export function createPageRenderTree(
  match: LoadedRouteMatch,
  scripts?: ScriptRenderContext,
) {
  const page = createElement(match.page, {
    data: match.data,
    locale: match.locale,
    path: match.path,
    pathname: match.pathname,
  });

  const tree = match.layouts.reduceRight<ReactNode>(
    (children, Layout) =>
      createElement(Layout, {
        children,
        locale: match.locale,
        path: match.path,
        pathname: match.pathname,
      }),
    page,
  );

  return scripts ? withScriptContext(scripts, tree) : tree;
}

export function createPageScriptContext(
  match: LoadedRouteMatch,
  options: { dev?: boolean; nonce?: string } = {},
) {
  return createScriptRenderContext({
    dev: options.dev,
    nonce: options.nonce,
    scripts: match.scripts,
  });
}
