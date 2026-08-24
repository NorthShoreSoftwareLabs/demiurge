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
  JsonCapability,
  RawResponseCapability,
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

declare const mutationResultType: unique symbol;

export type MutationMethod = "POST" | "PUT" | "PATCH" | "DELETE";

export type MutationCapability<
  TResult = unknown,
  TField extends string = string,
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> = RawResponseCapability<TPath, TValues> & {
  mutation: true;
  readonly [mutationResultType]: {
    data: TResult;
    fields: TField;
  };
};

export type MutationMethodsOf<TModule> = {
  [TMethod in keyof TModule as
    TMethod extends MutationMethod
      ? TModule[TMethod] extends MutationCapability ? TMethod : never
      : never]: TModule[TMethod] extends MutationCapability<infer TResult>
        ? TModule[TMethod] extends MutationCapability<TResult, infer TField>
          ? { data: TResult; fields: TField }
          : never
        : never;
};

type MutationResponseData<TResult> = Awaited<TResult> extends
  JsonCapability<infer TData, string, object> ? TData : unknown;

export type MutationValidationIssue<TField extends string = string> = {
  code: string;
  message: string;
  path: readonly [] | readonly [TField, ...(string | number)[]];
};

export type MutationValidation<TField extends string = string> = {
  issues: readonly MutationValidationIssue<TField>[];
};

export class MutationValidationError<TField extends string = string>
  extends Error {
  readonly validation: MutationValidation<TField>;

  constructor(validation: MutationValidation<TField>) {
    super("Mutation input validation failed.");
    this.name = "MutationValidationError";
    this.validation = {
      issues: validation.issues.map((issue) => ({
        ...issue,
        path: [...issue.path],
      })),
    };
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
  | MutationRevalidationDeclaration
  | ((
    context: MutationContext<TInput, TPath, TValues>,
  ) => MaybePromise<MutationRevalidationDeclaration>);

export type MutationRevalidationDeclaration = {
  keys?: readonly CacheKey[];
  tags?: readonly CacheTag[];
};

export const MUTATION_REVALIDATION_HEADER = "x-demiurge-revalidate-tags";

export type MutationOptions<
  TInput,
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
  TResult extends Response | ResponseCapability<TPath, TValues> =
    Response | ResponseCapability<TPath, TValues>,
  TField extends string = string,
> = {
  cors?: CorsPolicy;
  handler: (
    context: MutationContext<TInput, TPath, TValues>,
  ) => MaybePromise<TResult>;
  idempotency?: MutationIdempotency<TInput, TPath, TValues>;
  input?: MutationInput<TInput, TPath, TValues>;
  revalidateRoute?: boolean;
  revalidate?: MutationRevalidation<TInput, TPath, TValues>;
  security?: RouteSecurityPolicy;
  timing?: ServerTimingInput;
  validation?: {
    fields: readonly TField[];
  };
};

export function mutation<
  TInput = undefined,
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
  TResult extends Response | ResponseCapability<TPath, TValues> =
    Response | ResponseCapability<TPath, TValues>,
  TField extends string = string,
>(
  options: MutationOptions<TInput, TPath, TValues, TResult, TField>,
): MutationCapability<MutationResponseData<TResult>, TField, TPath, TValues> {
  const capability = response<TPath, TValues>(
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
        return mutationValidationResponse(context.request, error.validation);
      }
      const mutationContext: MutationContext<TInput, TPath, TValues> = {
        ...context,
        input,
      };
      const run = async () => {
        const result = await options.handler(mutationContext);
        const authoritative = result instanceof Response ||
          result.kind === "response" || result.kind === "not-found";
        const response = await resolveMutationResult(
          await validateMutationCapability(result, context),
          context,
        );
        return authoritative || !isMutationProtocolRequest(context.request)
          ? response
          : await mutationProtocolResponse(
            response,
            options.revalidateRoute === true,
          );
      };

      if (!options.idempotency) {
        const result = await run();
        if (!isSuccessfulMutationResponse(result)) return result;
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

      if (result.replayed) return withoutRevalidationHeader(result.value);
      if (!isSuccessfulMutationResponse(result.value)) return result.value;
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

  // TYPE-EVIDENCE: mutation() creates the raw response capability above. The
  // brand records the handler's JSON result type without adding runtime data.
  return {
    ...capability,
    mutation: true,
  } as MutationCapability<
    MutationResponseData<TResult>,
    TField,
    TPath,
    TValues
  >;
}

function isMutationProtocolRequest(request: Request) {
  return request.headers.get(MUTATION_REQUEST_HEADER) === MUTATION_REQUEST_VALUE;
}

function mutationValidationResponse(
  request: Request,
  validation: MutationValidation,
) {
  const body = isMutationProtocolRequest(request)
    ? { version: 1, status: "invalid", validation }
    : { type: "validation-error", validation };
  const serialized = serializeMutationResult(body);
  if (isMutationProtocolRequest(request)) {
    return new Response(serialized, {
      headers: { "content-type": MUTATION_RESPONSE_MEDIA_TYPE },
      status: 400,
    });
  }
  return new Response(serialized, {
    headers: { "content-type": "application/json; charset=utf-8" },
    status: 400,
  });
}

async function mutationProtocolResponse(response: Response, revalidateRoute: boolean) {
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) return response;
    return new Response(serializeMutationResult({
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
  return new Response(serializeMutationResult({
    version: 1,
    status: response.ok ? "success" : "failed",
    ...(revalidateRoute && response.ok ? { revalidate: true } : {}),
    ...(response.ok && data !== undefined ? { data } : {}),
  }), {
    headers: { "content-type": MUTATION_RESPONSE_MEDIA_TYPE },
    status: response.status,
  });
}

async function validateMutationCapability<
  TPath extends string,
  TValues extends object,
>(
  result: Response | ResponseCapability<TPath, TValues>,
  context: HttpRouteContext<TPath, TValues>,
) {
  if (result instanceof Response || result.kind !== "json") return result;
  const value = typeof result.value === "function"
    ? await result.value(context)
    : result.value;
  assertJsonValue(value);
  return { ...result, value };
}

function serializeMutationResult(value: unknown) {
  assertJsonValue(value);
  return JSON.stringify(value);
}

function assertJsonValue(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw unsupportedMutationValue();
  }
  if (typeof value !== "object") throw unsupportedMutationValue();
  if (seen.has(value)) throw unsupportedMutationValue();
  seen.add(value);

  if (Array.isArray(value)) {
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key)) {
        throw unsupportedMutationValue();
      }
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw unsupportedMutationValue();
      assertJsonValue(value[index], seen);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw unsupportedMutationValue();
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw unsupportedMutationValue();
      assertJsonValue(Object.getOwnPropertyDescriptor(value, key)?.value, seen);
    }
  }
  seen.delete(value);
}

function unsupportedMutationValue() {
  return new TypeError("A mutation result contains a value that JSON cannot serialize.");
}

function isSuccessfulMutationResponse(response: Response) {
  return response.status >= 200 && response.status < 400;
}

async function resolveRevalidation<
  TInput,
  TPath extends string,
  TValues extends object,
>(
  revalidate: MutationRevalidation<TInput, TPath, TValues> | undefined,
  context: MutationContext<TInput, TPath, TValues>,
) {
  if (!revalidate) return {};
  return typeof revalidate === "function"
    ? await revalidate(context)
    : revalidate;
}

async function addRevalidationHeader(
  result: Response,
  invalidation: MutationRevalidationDeclaration,
) {
  const headers = new Headers(result.headers);
  headers.delete(MUTATION_REVALIDATION_HEADER);
  const keys = invalidation.keys ?? [];
  const tags = invalidation.tags ?? [];
  if (keys.length > 0 || tags.length > 0) {
    headers.set(
      MUTATION_REVALIDATION_HEADER,
      encodeURIComponent(serializeMutationResult({
        keys,
        tags: tags.map((value) => value.id),
        version: 1,
      })),
    );
  }
  return new Response(result.body, {
    headers,
    status: result.status,
    statusText: result.statusText,
  });
}

function withoutRevalidationHeader(result: Response) {
  if (!result.headers.has(MUTATION_REVALIDATION_HEADER)) return result;
  const headers = new Headers(result.headers);
  headers.delete(MUTATION_REVALIDATION_HEADER);
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
