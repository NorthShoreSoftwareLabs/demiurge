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
  RouteRequestContexts,
} from "../routing/types";
import type {
  CorsPolicy,
  RoutePolicy,
  RouteSecurityPolicy,
} from "../security/types";
import type { HttpErrorStatus } from "./http-error";
export type { RoutePolicy } from "../security/types";
export type { RouteRequestContexts } from "../routing/types";

export type MaybePromise<T> = T | Promise<T>;

export type PathVars = Record<string, string>;

/**
 * Values that inherited middleware makes available to later server work.
 *
 * The carrier is mutable for one request. The framework never serializes it
 * into browser route props or navigation data.
 */
export type RequestContext<TValues extends object = Record<never, never>> =
  TValues;

export type RouteRequestContextFor<TPath extends string> = TPath extends
  keyof RouteRequestContexts
  ? RouteRequestContexts[TPath] extends object
    ? RouteRequestContexts[TPath]
    : Record<never, never>
  : Record<never, never>;

declare const middlewareContextBrand: unique symbol;

export type MiddlewareContextContribution<TValues extends object> = {
  readonly [middlewareContextBrand]: TValues;
};

export type MiddlewareContextOf<TMiddleware> = [TMiddleware] extends [
  MiddlewareContextContribution<infer TValues>,
]
  ? TValues
  : Record<never, never>;

type RequestContextField<TValues extends object> = {
  context: RequestContext<TValues>;
};

export type RouteContext<TPath extends string = string> = {
  path: RouteParamsFor<TPath>;
  pathname: string;
};

export type HttpRouteContext<
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> = RouteContext<TPath> & RequestContextField<TValues> & {
  request: Request;
  search: URLSearchParams;
  url: URL;
};

export type PageDataContext<
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> = HttpRouteContext<TPath, TValues> & {
    cache: Cache;
  };

export type PageDataFunction<
  TPath extends string = string,
  TData = unknown,
  TValues extends object = RouteRequestContextFor<TPath>,
> = (
  context: PageDataContext<TPath, TValues>,
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

export type RouteMiddleware<
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> = (
  context: HttpRouteContext<TPath, TValues>,
  next: RouteMiddlewareNext,
) => MaybePromise<Response>;

type AnyRouteMiddleware = {
  bivarianceHack(
    context: HttpRouteContext<string, object>,
    next: RouteMiddlewareNext,
  ): MaybePromise<Response>;
}["bivarianceHack"];

export type RouteValue<
  T,
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> =
  | T
  | ((context: HttpRouteContext<TPath, TValues>) => MaybePromise<T>);

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
  status: HttpErrorStatus;
};

export type RouteDefaultComponent =
  | ComponentType
  | ComponentType<LayoutProps>
  | ComponentType<NotFoundProps>
  | ComponentType<RouteErrorProps>;

export type PageCapability<
  TPath extends string = string,
  TData = undefined,
  TValues extends object = RouteRequestContextFor<TPath>,
> = {
  data?: PageDataFunction<TPath, TData, TValues>;
  kind: "page";
  layout?: false;
  render: PageRenderOptions;
  view: ComponentType<RouteProps<TPath, TData>>;
};

export type PageRenderMode = "ssr" | "static" | "streaming";

export type PageRenderOptions = {
  mode: PageRenderMode;
};

export type AnyPageCapability = {
  data?: {
    bivarianceHack(
      context: PageDataContext<string, object>,
    ): MaybePromise<unknown>;
  }["bivarianceHack"];
  kind: "page";
  layout?: false;
  render: PageRenderOptions;
  view: unknown;
};

export type JsonCapability<
  T = unknown,
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> = {
  cors?: CorsPolicy;
  kind: "json";
  security?: RouteSecurityPolicy;
  timing?: readonly ServerTimingMetric[];
  value: RouteValue<T, TPath, TValues>;
  init?: ResponseInit;
};

export type JsonLinesSource =
  | Iterable<unknown>
  | AsyncIterable<unknown>
  | ReadableStream<unknown>;

export type JsonLinesCapability<
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> = {
  cors?: CorsPolicy;
  init?: ResponseInit;
  kind: "jsonl";
  lines: RouteValue<JsonLinesSource, TPath, TValues>;
  security?: RouteSecurityPolicy;
  timing?: readonly ServerTimingMetric[];
};

export type TextCapability<
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> = {
  cors?: CorsPolicy;
  kind: "text";
  security?: RouteSecurityPolicy;
  timing?: readonly ServerTimingMetric[];
  value: RouteValue<string, TPath, TValues>;
  init?: ResponseInit;
};

export type HtmlCapability<
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> = {
  cors?: CorsPolicy;
  kind: "html";
  security?: RouteSecurityPolicy;
  timing?: readonly ServerTimingMetric[];
  value: RouteValue<string, TPath, TValues>;
  init?: ResponseInit;
};

export type RedirectCapability<
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> = {
  cors?: CorsPolicy;
  kind: "redirect";
  security?: RouteSecurityPolicy;
  timing?: readonly ServerTimingMetric[];
  to: RouteValue<string | URL, TPath, TValues>;
  init?: ResponseInit;
};

export type NotFoundCapability<
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> = {
  cors?: CorsPolicy;
  kind: "not-found";
  security?: RouteSecurityPolicy;
  timing?: readonly ServerTimingMetric[];
  body?: RouteValue<string, TPath, TValues>;
  init?: ResponseInit;
};

export type RawResponseCapability<
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> = {
  cors?: CorsPolicy;
  kind: "response";
  response: RouteValue<Response, TPath, TValues>;
  security?: RouteSecurityPolicy;
  timing?: readonly ServerTimingMetric[];
};

export type StreamChunk = string | Uint8Array;

export type StreamSource =
  | Iterable<StreamChunk>
  | AsyncIterable<StreamChunk>
  | ReadableStream<StreamChunk>;

export type StreamCapability<
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> = {
  body: RouteValue<StreamSource, TPath, TValues>;
  cors?: CorsPolicy;
  init?: ResponseInit;
  kind: "stream";
  security?: RouteSecurityPolicy;
  timing?: readonly ServerTimingMetric[];
};

export type ServerSentEvent = {
  comment?: string;
  data?: unknown;
  event?: string;
  id?: string;
  retry?: number;
};

export type ServerSentEventSource =
  | Iterable<ServerSentEvent | string>
  | AsyncIterable<ServerSentEvent | string>
  | ReadableStream<ServerSentEvent | string>;

export type ServerSentEventsCapability<
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> = {
  cors?: CorsPolicy;
  events: RouteValue<ServerSentEventSource, TPath, TValues>;
  init?: ResponseInit;
  kind: "sse";
  security?: RouteSecurityPolicy;
  timing?: readonly ServerTimingMetric[];
};

export type ResponseCapability<
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> =
  | JsonCapability<unknown, TPath, TValues>
  | JsonLinesCapability<TPath, TValues>
  | TextCapability<TPath, TValues>
  | HtmlCapability<TPath, TValues>
  | RedirectCapability<TPath, TValues>
  | NotFoundCapability<TPath, TValues>
  | RawResponseCapability<TPath, TValues>
  | StreamCapability<TPath, TValues>
  | ServerSentEventsCapability<TPath, TValues>;

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
  TValues extends object = RouteRequestContextFor<TPath>,
> = {
  data?: PageDataFunction<TPath, TData, TValues>;
  layout?: false;
  render?: PageRenderOptions;
  view: ComponentType<RouteProps<TPath, TData>>;
};

export type ResponseOptions = ResponseInit & {
  cors?: CorsPolicy;
  security?: RouteSecurityPolicy;
  timing?: ServerTimingInput;
};

export type ServerTimingMetric = {
  description?: string;
  duration?: number;
  name: string;
};

export type ServerTimingInput =
  | ServerTimingMetric
  | readonly ServerTimingMetric[];

export type RouteModule = {
  GET?: RouteCapability;
  POST?: ResponseCapability;
  PUT?: ResponseCapability;
  PATCH?: ResponseCapability;
  DELETE?: ResponseCapability;
  OPTIONS?: ResponseCapability;
  HEAD?: ResponseCapability;
  default?: RouteDefaultComponent;
  // `@not-found.tsx` opts out of inherited layouts with `export const layout =
  // false`, mirroring the escape hatch a page capability already has.
  layout?: false;
  links?: LinkContribution;
  metadata?: Metadata;
  middleware?: AnyRouteMiddleware;
  paths?: StaticPathsFunction;
  policy?: RoutePolicy;
  scripts?: ScriptContribution;
};

export type RouteImporter = () => Promise<RouteModule>;
