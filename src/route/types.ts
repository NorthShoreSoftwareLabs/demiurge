import type { ComponentType, ReactNode } from "react";
import type { RouteParamsFor } from "../routing/types";

export type MaybePromise<T> = T | Promise<T>;

export type PathVars = Record<string, string>;

export type RouteContext<TPath extends string = string> = {
  path: RouteParamsFor<TPath>;
  pathname: string;
};

export type HttpRouteContext<TPath extends string = string> = RouteContext<TPath> & {
  request: Request;
  search: URLSearchParams;
  url: URL;
};

export type RouteValue<T> =
  | T
  | ((context: HttpRouteContext) => MaybePromise<T>);

export type RouteProps<TPath extends string = string> = RouteContext<TPath>;

export type LayoutProps<TPath extends string = string> = RouteContext<TPath> & {
  children: ReactNode;
};

export type PageCapability<TPath extends string = string> = {
  kind: "page";
  view: ComponentType<RouteProps<TPath>>;
  layout?: false;
};

export type JsonCapability<T = unknown> = {
  kind: "json";
  value: RouteValue<T>;
  init?: ResponseInit;
};

export type TextCapability = {
  kind: "text";
  value: RouteValue<string>;
  init?: ResponseInit;
};

export type HtmlCapability = {
  kind: "html";
  value: RouteValue<string>;
  init?: ResponseInit;
};

export type RedirectCapability = {
  kind: "redirect";
  to: RouteValue<string | URL>;
  init?: ResponseInit;
};

export type NotFoundCapability = {
  kind: "not-found";
  body?: RouteValue<string>;
  init?: ResponseInit;
};

export type RawResponseCapability = {
  kind: "response";
  response: RouteValue<Response>;
};

export type ResponseCapability =
  | JsonCapability
  | TextCapability
  | HtmlCapability
  | RedirectCapability
  | NotFoundCapability
  | RawResponseCapability;

export type RouteCapability = PageCapability | ResponseCapability;

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD";

export type PageOptions<TPath extends string = string> = {
  view: ComponentType<RouteProps<TPath>>;
  layout?: false;
};

export type RouteModule = {
  GET?: RouteCapability;
  POST?: ResponseCapability;
  PUT?: ResponseCapability;
  PATCH?: ResponseCapability;
  DELETE?: ResponseCapability;
  OPTIONS?: ResponseCapability;
  HEAD?: ResponseCapability;
  default?: ComponentType<LayoutProps>;
};

export type RouteImporter = () => Promise<RouteModule>;
