import type { ComponentType, ReactNode } from "react";
import type { Cache } from "../data";
import type {
  LinkContribution,
  Metadata,
  ScriptContribution,
} from "../document";
import type {
  PathValue,
  PathVarsFor,
  RouteParamsFor,
  RoutePathVars,
} from "../routing/types";
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

export type PageDataContext<TPath extends string = string> =
  HttpRouteContext<TPath> & {
    cache: Cache;
  };

export type PageDataFunction<TPath extends string = string, TData = unknown> = (
  context: PageDataContext<TPath>,
) => MaybePromise<TData>;

export type StaticPathsContext = {
  cache: Cache;
};

export type StaticPath<TPath extends string = string> =
  TPath extends keyof RoutePathVars & string
    ? PathVarsFor<TPath>
    : Record<string, PathValue>;

export type StaticPathsFunction<TPath extends string = string> = (
  context: StaticPathsContext,
) => MaybePromise<readonly StaticPath<TPath>[]>;

export type RouteMiddlewareNext = () => MaybePromise<Response>;

export type RouteMiddleware<TPath extends string = string> = (
  context: HttpRouteContext<TPath>,
  next: RouteMiddlewareNext,
) => MaybePromise<Response>;

export type RouteValue<T> =
  | T
  | ((context: HttpRouteContext) => MaybePromise<T>);

export type RouteProps<
  TPath extends string = string,
  TData = undefined,
> = RouteContext<TPath> & ([TData] extends [undefined]
  ? { data?: undefined }
  : { data: TData });

export type LayoutProps<TPath extends string = string> = RouteContext<TPath> & {
  children: ReactNode;
};

export type NotFoundProps = {
  pathname: string;
};

export type RouteErrorProps = {
  error: unknown;
  pathname: string;
};

export type RouteDefaultComponent =
  | ComponentType
  | ComponentType<LayoutProps>
  | ComponentType<NotFoundProps>
  | ComponentType<RouteErrorProps>;

export type PageCapability<
  TPath extends string = string,
  TData = undefined,
> = {
  data?: PageDataFunction<TPath, TData>;
  kind: "page";
  layout?: false;
  view: ComponentType<RouteProps<TPath, TData>>;
};

export type AnyPageCapability = {
  data?: PageDataFunction<string, unknown>;
  kind: "page";
  layout?: false;
  view: unknown;
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

export type RouteCapability = AnyPageCapability | ResponseCapability;

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD";

export type PageOptions<
  TPath extends string = string,
  TData = undefined,
> = {
  data?: PageDataFunction<TPath, TData>;
  layout?: false;
  view: ComponentType<RouteProps<TPath, TData>>;
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
  default?: RouteDefaultComponent;
  links?: LinkContribution;
  metadata?: Metadata;
  middleware?: RouteMiddleware;
  paths?: StaticPathsFunction;
  policy?: RoutePolicy;
  scripts?: ScriptContribution;
};

export type RouteImporter = () => Promise<RouteModule>;
