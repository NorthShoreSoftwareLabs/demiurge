import { createElement, type ReactNode } from "react";
import type { LoadedRouteMatch } from "../router";

export function createPageRenderTree(match: LoadedRouteMatch) {
  const page = createElement(match.page, {
    data: match.data,
    path: match.path,
    pathname: match.pathname,
  });

  return match.layouts.reduceRight<ReactNode>(
    (children, Layout) =>
      createElement(Layout, {
        children,
        path: match.path,
        pathname: match.pathname,
      }),
    page,
  );
}
