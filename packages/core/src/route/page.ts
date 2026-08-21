import type { ComponentType } from "react";
import type {
  PageCapability,
  PageOptions,
  RouteProps,
  RouteRequestContextFor,
} from "./types";

export function page<const TPath extends string = string>(
  options: ComponentType<RouteProps<TPath>>,
): PageCapability<TPath>;
export function page<
  const TPath extends string = string,
  TData = undefined,
  TValues extends object = RouteRequestContextFor<TPath>,
>(
  options: PageOptions<TPath, TData, TValues>,
): PageCapability<TPath, TData, TValues>;
export function page<
  const TPath extends string = string,
  TData = undefined,
  TValues extends object = RouteRequestContextFor<TPath>,
>(
  options: PageOptions<TPath, TData, TValues> | ComponentType<RouteProps<TPath>>,
): PageCapability<TPath, TData, TValues> | PageCapability<TPath> {
  if (typeof options === "function") {
    return {
      kind: "page",
      render: { mode: "ssr" },
      view: options,
    } satisfies PageCapability<TPath>;
  }

  // TYPE-EVIDENCE: the object literal carries the fields that the page capability type requires. The cast asserts that structural match.
  return {
    data: options.data,
    kind: "page",
    layout: options.layout,
    render: options.render ?? { mode: "ssr" },
    view: options.view,
  } as PageCapability<TPath, TData, TValues>;
}
