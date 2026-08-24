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

export type MutationInput<
  TInput,
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> = (
  context: HttpRouteContext<TPath, TValues>,
) => MaybePromise<TInput>;

export const MUTATION_REQUEST_HEADER = "x-demiurge-mutation";
export const MUTATION_REQUEST_VALUE = "data;v=1";
export const MUTATION_RESPONSE_MEDIA_TYPE = "application/vnd.demiurge.mutation+json;v=1";

export type MutationValidationIssue = {
  code: string;
  message: string;
  path: readonly (string | number)[];
};

export class MutationValidationError extends Error {
  readonly issues: readonly MutationValidationIssue[];

  constructor(issues: readonly MutationValidationIssue[]) {
    super("Mutation input validation failed.");
    this.name = "MutationValidationError";
    this.issues = issues.map((issue) => ({ ...issue, path: [...issue.path] }));
  }
}

export type MutationContext<
  TInput,
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> = HttpRouteContext<TPath, TValues> & {
  input: TInput;
};

export type MutationIdempotency<
  TInput,
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> = {
  key: CacheKey | ((context: MutationContext<TInput, TPath, TValues>) => CacheKey);
  store: IdempotencyStore;
  ttl?: CacheDuration;
};

export type MutationRevalidation<
  TInput,
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> =
  | readonly CacheTag[]
  | ((
    context: MutationContext<TInput, TPath, TValues>,
  ) => MaybePromise<readonly CacheTag[]>);

export const MUTATION_REVALIDATION_HEADER = "x-demiurge-revalidate-tags";

export type MutationOptions<
  TInput,
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> = {
  cors?: CorsPolicy;
  handler: (
    context: MutationContext<TInput, TPath, TValues>,
  ) => MaybePromise<Response | ResponseCapability<TPath, TValues>>;
  idempotency?: MutationIdempotency<TInput, TPath, TValues>;
  input?: MutationInput<TInput, TPath, TValues>;
  revalidateRoute?: boolean;
  revalidate?: MutationRevalidation<TInput, TPath, TValues>;
  security?: RouteSecurityPolicy;
  timing?: ServerTimingInput;
};

export function mutation<
  TInput = undefined,
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
>(
  options: MutationOptions<TInput, TPath, TValues>,
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
        if (!(error instanceof MutationValidationError)) throw error;
        return mutationValidationResponse(context.request, error.issues);
      }
      const mutationContext: MutationContext<TInput, TPath, TValues> = {
        ...context,
        input,
      };
      const run = async () => {
        const result = await options.handler(mutationContext);
        const raw = result instanceof Response;
        const response = await resolveMutationResult(result, context);
        return raw || !isMutationProtocolRequest(context.request)
          ? response
          : await mutationProtocolResponse(response, options.revalidateRoute === true);
      };

      if (!options.idempotency) {
        const result = await run();
        const revalidation = await resolveRevalidation(
          options.revalidate,
          mutationContext,
        );
        return await addRevalidationHeader(result, revalidation);
      }

      const key = typeof options.idempotency.key === "function"
        ? options.idempotency.key(mutationContext)
        : options.idempotency.key;
      const result = await options.idempotency.store.run({
        fn: run,
        key,
        ttl: options.idempotency.ttl,
      });

      if (result.replayed) return result.value;
      const revalidation = await resolveRevalidation(
        options.revalidate,
        mutationContext,
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

function isMutationProtocolRequest(request: Request) {
  return request.headers.get(MUTATION_REQUEST_HEADER) === MUTATION_REQUEST_VALUE;
}

function mutationValidationResponse(
  request: Request,
  issues: readonly MutationValidationIssue[],
) {
  if (isMutationProtocolRequest(request)) {
    return new Response(JSON.stringify({
      version: 1,
      status: "invalid",
      data: { issues },
    }), {
      headers: { "content-type": MUTATION_RESPONSE_MEDIA_TYPE },
      status: 400,
    });
  }
  return new Response(JSON.stringify({ issues, type: "validation-error" }), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status: 400,
  });
}

async function mutationProtocolResponse(response: Response, revalidateRoute: boolean) {
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) return response;
    return new Response(JSON.stringify({
      version: 1,
      status: "redirect",
      location,
      history: response.status === 301 || response.status === 308 ? "replace" : "push",
    }), {
      headers: { "content-type": MUTATION_RESPONSE_MEDIA_TYPE },
      status: 200,
    });
  }
  const data = response.headers.get("content-type")?.includes("json")
    ? await response.clone().json().catch(() => undefined)
    : undefined;
  return new Response(JSON.stringify({
    version: 1,
    status: response.ok ? "success" : "failed",
    ...(revalidateRoute && response.ok ? { revalidate: true } : {}),
    ...(data === undefined ? {} : { data }),
  }), {
    headers: { "content-type": MUTATION_RESPONSE_MEDIA_TYPE },
    status: response.status,
  });
}

async function resolveRevalidation<
  TInput,
  TPath extends string,
  TValues extends object,
>(
  revalidate: MutationRevalidation<TInput, TPath, TValues> | undefined,
  context: MutationContext<TInput, TPath, TValues>,
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
    MUTATION_REVALIDATION_HEADER,
    tags.map((value) => value.id).join(","),
  );
  return new Response(result.body, {
    headers,
    status: result.status,
    statusText: result.statusText,
  });
}

export const mutationInput = {
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

async function resolveMutationResult<
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
