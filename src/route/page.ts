import type { ComponentType } from "react";
import type { PageCapability, PageOptions, RouteProps } from "./types";

export function page<const TPath extends string = string>(
  options: ComponentType<RouteProps<TPath>>,
): PageCapability<TPath>;
export function page<const TPath extends string = string, TData = undefined>(
  options: PageOptions<TPath, TData>,
): PageCapability<TPath, TData>;
export function page<const TPath extends string = string, TData = undefined>(
  options: PageOptions<TPath, TData> | ComponentType<RouteProps<TPath>>,
): PageCapability<TPath, TData> | PageCapability<TPath> {
  if (typeof options === "function") {
    return {
      kind: "page",
      view: options,
    } satisfies PageCapability<TPath>;
  }

  return {
    data: options.data,
    kind: "page",
    view: options.view,
    layout: options.layout,
  } satisfies PageCapability<TPath, TData>;
}
