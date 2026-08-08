import type { ComponentType } from "react";
import type { PageCapability, PageOptions, RouteProps } from "./types";

export function page<const TPath extends string = string>(
  options: PageOptions<TPath> | ComponentType<RouteProps<TPath>>,
) {
  if (typeof options === "function") {
    return {
      kind: "page",
      view: options,
    } satisfies PageCapability<TPath>;
  }

  return {
    kind: "page",
    view: options.view,
    layout: options.layout,
  } satisfies PageCapability<TPath>;
}
