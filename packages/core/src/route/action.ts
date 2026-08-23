import type {
  CacheDuration,
  CacheKey,
  CacheTag,
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

export type ActionValidationIssue = {
  code: string;
  message: string;
  path: readonly (string | number)[];
};

export class ActionValidationError extends Error {
  readonly issues: readonly ActionValidationIssue[];

  constructor(issues: readonly ActionValidationIssue[]) {
    super("Action input validation failed.");
    this.name = "ActionValidationError";
    this.issues = issues.map((issue) => ({ ...issue, path: [...issue.path] }));
  }
}

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

export type ActionRevalidation<
  TInput,
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> =
  | readonly CacheTag[]
  | ((
    context: ActionContext<TInput, TPath, TValues>,
  ) => MaybePromise<readonly CacheTag[]>);

export const ACTION_REVALIDATION_HEADER = "x-demiurge-revalidate-tags";

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
  revalidate?: ActionRevalidation<TInput, TPath, TValues>;
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
      let input: TInput;
      try {
        // TYPE-EVIDENCE: the input defaults to undefined when the caller did not provide a parser. The cast labels that fallback as TInput.
        const absentInput = undefined as TInput;
        input = options.input
          ? await options.input(context)
          : absentInput;
      } catch (error) {
        if (!(error instanceof ActionValidationError)) throw error;
        return new Response(JSON.stringify({
          issues: error.issues,
          type: "validation-error",
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 400,
        });
      }
      const actionContext: ActionContext<TInput, TPath, TValues> = {
        ...context,
        input,
      };
      const run = async () => await resolveActionResult(
        await options.handler(actionContext),
        context,
      );

      if (!options.idempotency) {
        const result = await run();
        const revalidation = await resolveRevalidation(
          options.revalidate,
          actionContext,
        );
        return await addRevalidationHeader(result, revalidation);
      }

      const key = typeof options.idempotency.key === "function"
        ? options.idempotency.key(actionContext)
        : options.idempotency.key;
      const result = await options.idempotency.store.run({
        fn: run,
        key,
        ttl: options.idempotency.ttl,
      });

      if (result.replayed) return result.value;
      const revalidation = await resolveRevalidation(
        options.revalidate,
        actionContext,
      );
      return await addRevalidationHeader(result.value, revalidation);
    },
    {
      cors: options.cors,
      security: options.security,
      timing: options.timing,
    },
  );
}

async function resolveRevalidation<
  TInput,
  TPath extends string,
  TValues extends object,
>(
  revalidate: ActionRevalidation<TInput, TPath, TValues> | undefined,
  context: ActionContext<TInput, TPath, TValues>,
) {
  if (!revalidate) return [];
  return typeof revalidate === "function"
    ? await revalidate(context)
    : revalidate;
}

async function addRevalidationHeader(
  result: Response,
  tags: readonly CacheTag[],
) {
  if (tags.length === 0) return result;
  const headers = new Headers(result.headers);
  headers.set(
    ACTION_REVALIDATION_HEADER,
    tags.map((value) => value.id).join(","),
  );
  return new Response(result.body, {
    headers,
    status: result.status,
    statusText: result.statusText,
  });
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
