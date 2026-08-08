import type { ComponentType, ReactNode } from "react";
import type { RouteParamsFor } from "../routing/types";
import type {
  CorsPolicy,
  RoutePolicy,
  RouteSecurityPolicy,
} from "../security/types";
export type { RoutePolicy } from "../security/types";

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

export type RouteMiddlewareNext = () => MaybePromise<Response>;

export type RouteMiddleware<TPath extends string = string> = (
  context: HttpRouteContext<TPath>,
  next: RouteMiddlewareNext,
) => MaybePromise<Response>;

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
  cors?: CorsPolicy;
  kind: "json";
  security?: RouteSecurityPolicy;
  value: RouteValue<T>;
  init?: ResponseInit;
};

export type TextCapability = {
  cors?: CorsPolicy;
  kind: "text";
  security?: RouteSecurityPolicy;
  value: RouteValue<string>;
  init?: ResponseInit;
};

export type HtmlCapability = {
  cors?: CorsPolicy;
  kind: "html";
  security?: RouteSecurityPolicy;
  value: RouteValue<string>;
  init?: ResponseInit;
};

export type RedirectCapability = {
  cors?: CorsPolicy;
  kind: "redirect";
  security?: RouteSecurityPolicy;
  to: RouteValue<string | URL>;
  init?: ResponseInit;
};

export type NotFoundCapability = {
  cors?: CorsPolicy;
  kind: "not-found";
  security?: RouteSecurityPolicy;
  body?: RouteValue<string>;
  init?: ResponseInit;
};

export type RawResponseCapability = {
  cors?: CorsPolicy;
  kind: "response";
  response: RouteValue<Response>;
  security?: RouteSecurityPolicy;
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

export type ResponseOptions = ResponseInit & {
  cors?: CorsPolicy;
  security?: RouteSecurityPolicy;
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
  middleware?: RouteMiddleware;
  policy?: RoutePolicy;
};

export type RouteImporter = () => Promise<RouteModule>;
