import type {
  CacheDuration,
  CacheKey,
  IdempotencyStore,
} from "../data";
import type {
  CorsPolicy,
  RouteSecurityPolicy,
} from "../security";
import type {
  HttpRouteContext,
  MaybePromise,
  ResponseCapability,
  RouteRequestContextFor,
  ServerTimingInput,
} from "./types";
import { response, toResponse } from "./response";

export type ActionInput<
  TInput,
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> = (
  context: HttpRouteContext<TPath, TValues>,
) => MaybePromise<TInput>;

export type ActionContext<
  TInput,
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> = HttpRouteContext<TPath, TValues> & {
  input: TInput;
};

export type ActionIdempotency<
  TInput,
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> = {
  key: CacheKey | ((context: ActionContext<TInput, TPath, TValues>) => CacheKey);
  store: IdempotencyStore;
  ttl?: CacheDuration;
};

export type ActionOptions<
  TInput,
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> = {
  cors?: CorsPolicy;
  handler: (
    context: ActionContext<TInput, TPath, TValues>,
  ) => MaybePromise<Response | ResponseCapability<TPath, TValues>>;
  idempotency?: ActionIdempotency<TInput, TPath, TValues>;
  input?: ActionInput<TInput, TPath, TValues>;
  security?: RouteSecurityPolicy;
  timing?: ServerTimingInput;
};

export function action<
  TInput = undefined,
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
>(
  options: ActionOptions<TInput, TPath, TValues>,
) {
  return response<TPath, TValues>(
    async (context) => {
      // TYPE-EVIDENCE: the input defaults to undefined when the caller did not provide a parser. The cast labels that fallback as TInput.
      const input = options.input
        ? await options.input(context)
        : undefined as TInput;
      const actionContext: ActionContext<TInput, TPath, TValues> = {
        ...context,
        input,
      };
      const run = async () => await resolveActionResult(
        await options.handler(actionContext),
        context,
      );

      if (!options.idempotency) {
        return await run();
      }

      const key = typeof options.idempotency.key === "function"
        ? options.idempotency.key(actionContext)
        : options.idempotency.key;
      const result = await options.idempotency.store.run({
        fn: run,
        key,
        ttl: options.idempotency.ttl,
      });

      return result.value;
    },
    {
      cors: options.cors,
      security: options.security,
      timing: options.timing,
    },
  );
}

export const actionInput = {
  async formData({ request }: HttpRouteContext) {
    return await request.formData();
  },
  async json({ request }: HttpRouteContext) {
    // TYPE-EVIDENCE: the request body is JSON and the caller parses it to a known type. The cast widens the parsed value to unknown.
    return await request.json() as unknown;
  },
  async text({ request }: HttpRouteContext) {
    return await request.text();
  },
};

async function resolveActionResult<
  TPath extends string,
  TValues extends object,
>(
  result: Response | ResponseCapability<TPath, TValues>,
  context: HttpRouteContext<TPath, TValues>,
) {
  if (result instanceof Response) {
    return result;
  }

  return await toResponse(result, context);
}
