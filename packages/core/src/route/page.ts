import type { ComponentType } from "react";
import type { DataProjection } from "./projection";
import type {
  PageCapability,
  PageDataFunction,
  PageOptions,
  PageRenderOptions,
  RouteProps,
  RouteRequestContextFor,
} from "./types";

export function page<const TPath extends string = string>(
  options: ComponentType<RouteProps<TPath>>,
): PageCapability<TPath>;
export function page<
  const TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
>(
  options: {
    data?: undefined;
    layout?: false;
    project?: undefined;
    publicData?: undefined;
    render?: PageRenderOptions;
    view: ComponentType<RouteProps<TPath>>;
  },
): PageCapability<TPath, undefined, TValues>;
export function page<
  const TPath extends string = string,
  TData = undefined,
  TPublic = TData,
  TValues extends object = RouteRequestContextFor<TPath>,
>(
  options: {
    data: PageDataFunction<TPath, TData, TValues>;
    layout?: false;
    project: DataProjection<TData, TPublic>;
    publicData?: undefined;
    render?: PageRenderOptions;
    view: ComponentType<RouteProps<TPath, TPublic>>;
  },
): PageCapability<TPath, TPublic, TValues>;
export function page<
  const TPath extends string = string,
  TData = undefined,
  TValues extends object = RouteRequestContextFor<TPath>,
>(
  options: {
    data: PageDataFunction<TPath, TData, TValues>;
    layout?: false;
    project?: undefined;
    publicData: true;
    render?: PageRenderOptions;
    view: ComponentType<RouteProps<TPath, TData>>;
  },
): PageCapability<TPath, TData, TValues>;
export function page<
  const TPath extends string = string,
  TData = undefined,
  TPublic = TData,
  TValues extends object = RouteRequestContextFor<TPath>,
>(
  options:
    | PageOptions<TPath, TData, TPublic, TValues>
    | ComponentType<RouteProps<TPath>>,
): PageCapability<TPath, TPublic, TValues> | PageCapability<TPath> {
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
    project: options.project,
    publicData: options.publicData,
    render: options.render ?? { mode: "ssr" },
    view: options.view,
  } as PageCapability<TPath, TPublic, TValues>;
}
