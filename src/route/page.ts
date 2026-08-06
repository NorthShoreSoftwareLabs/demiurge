import type { ComponentType } from "react";
import type { PageCapability, PageOptions, RouteProps } from "./types";

export function page(options: PageOptions | ComponentType<RouteProps>) {
  if (typeof options === "function") {
    return {
      kind: "page",
      view: options,
    } satisfies PageCapability;
  }

  return {
    kind: "page",
    view: options.view,
    layout: options.layout,
  } satisfies PageCapability;
}
