import type { ComponentType, ReactNode } from "react";

export type PathVars = Record<string, string>;

export type RouteContext = {
  path: PathVars;
  pathname: string;
};

export type RouteProps = RouteContext;

export type LayoutProps = RouteContext & {
  children: ReactNode;
};

export type PageCapability = {
  kind: "page";
  view: ComponentType<RouteProps>;
  layout?: false;
};

export type PageOptions = {
  view: ComponentType<RouteProps>;
  layout?: false;
};

export type RouteModule = {
  GET?: PageCapability;
  default?: ComponentType<LayoutProps>;
};

export type RouteImporter = () => Promise<RouteModule>;
