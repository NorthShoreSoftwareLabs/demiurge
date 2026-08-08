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
  ServerTimingInput,
} from "./types";
import { response, toResponse } from "./response";

export type ActionInput<TInput> = (
  context: HttpRouteContext,
) => MaybePromise<TInput>;

export type ActionContext<TInput> = HttpRouteContext & {
  input: TInput;
};

export type ActionIdempotency<TInput> = {
  key: CacheKey | ((context: ActionContext<TInput>) => CacheKey);
  store: IdempotencyStore;
  ttl?: CacheDuration;
};

export type ActionOptions<TInput> = {
  cors?: CorsPolicy;
  handler: (
    context: ActionContext<TInput>,
  ) => MaybePromise<Response | ResponseCapability>;
  idempotency?: ActionIdempotency<TInput>;
  input?: ActionInput<TInput>;
  security?: RouteSecurityPolicy;
  timing?: ServerTimingInput;
};

export function action<TInput = undefined>(
  options: ActionOptions<TInput>,
) {
  return response(
    async (context) => {
      const input = options.input
        ? await options.input(context)
        : undefined as TInput;
      const actionContext = {
        ...context,
        input,
      } satisfies ActionContext<TInput>;
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
    return await request.json() as unknown;
  },
  async text({ request }: HttpRouteContext) {
    return await request.text();
  },
};

async function resolveActionResult(
  result: Response | ResponseCapability,
  context: HttpRouteContext,
) {
  if (result instanceof Response) {
    return result;
  }

  return await toResponse(result, context);
}
