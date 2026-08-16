import type {
  HttpRouteContext,
  MaybePromise,
  MiddlewareContextContribution,
  RouteMiddleware,
  RouteMiddlewareNext,
} from "./types";

/**
 * Declares the request-context values that a middleware can read and write.
 * The framework passes one carrier to every inherited middleware in a request.
 */
export function defineMiddleware<TValues extends object>(
  middleware: (
    context: HttpRouteContext<string, TValues>,
    next: RouteMiddlewareNext,
  ) => MaybePromise<Response>,
): RouteMiddleware<string, TValues> & MiddlewareContextContribution<TValues> {
  return middleware as RouteMiddleware<string, TValues> &
    MiddlewareContextContribution<TValues>;
}
