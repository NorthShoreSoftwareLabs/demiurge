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
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { response, toResponse } from "./response";
import {
  projectRouteData,
  type DataProjection,
  type DisclosureDeclaration,
} from "./projection";

declare const mutationInputFields: unique symbol;

export type MutationInput<
  TInput,
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
> = {
  (context: HttpRouteContext<TPath, TValues>): MaybePromise<TInput>;
};

type TypedMutationInput<
  TInput,
  TPath extends string,
  TValues extends object,
  TField extends string,
> = MutationInput<TInput, TPath, TValues> & {
  readonly [mutationInputFields]: { field: TField; input: TInput };
};

type MutationInputValue<TParser> = TParser extends {
  readonly [mutationInputFields]: { input: infer TInput };
} ? TInput : never;

type MutationInputField<TParser> = TParser extends {
  readonly [mutationInputFields]: { field: infer TField extends string };
} ? TField : never;

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
  TPublic = MutationResponseData<TResult>,
> = {
  cors?: CorsPolicy;
  /**
   * Selects the fields that the browser receives from a JSON mutation result.
   *
   * The projection is a typed function or a Standard Schema. The projection
   * covers nested fields.
   */
  project?: DataProjection<MutationResponseData<TResult>, TPublic>;
  /**
   * Declares that the whole JSON mutation result is public.
   *
   * Use this declaration only when the handler already returns a minimal
   * public object.
   */
  publicData?: true;
  handler: (
    context: MutationContext<NoInfer<TInput>, TPath, TValues>,
  ) => MaybePromise<TResult>;
  idempotency?: MutationIdempotency<NoInfer<TInput>, TPath, TValues>;
  input?: MutationInput<TInput, TPath, TValues>;
  revalidateRoute?: boolean;
  revalidate?: MutationRevalidation<NoInfer<TInput>, TPath, TValues>;
  security?: RouteSecurityPolicy;
  timing?: ServerTimingInput;
};

export function mutation<
  TParser extends TypedMutationInput<unknown, TPath, TValues, string>,
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
  TResult extends Response | ResponseCapability<TPath, TValues> =
    Response | ResponseCapability<TPath, TValues>,
  TPublic = MutationResponseData<TResult>,
>(
  options: Omit<MutationOptions<
    MutationInputValue<TParser>,
    TPath,
    TValues,
    TResult,
    TPublic
  >, "input"> & {
    input: TParser;
  },
): MutationCapability<
  TPublic,
  MutationInputField<TParser>,
  TPath,
  TValues
>;

export function mutation<
  TInput,
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
  TResult extends Response | ResponseCapability<TPath, TValues> =
    Response | ResponseCapability<TPath, TValues>,
  TPublic = MutationResponseData<TResult>,
>(
  options: MutationOptions<TInput, TPath, TValues, TResult, TPublic> & {
    input: MutationInput<TInput, TPath, TValues>;
  },
): MutationCapability<TPublic, string, TPath, TValues>;

export function mutation<
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
  TResult extends Response | ResponseCapability<TPath, TValues> =
    Response | ResponseCapability<TPath, TValues>,
  TPublic = MutationResponseData<TResult>,
>(
  options: MutationOptions<undefined, TPath, TValues, TResult, TPublic> & {
    input?: undefined;
  },
): MutationCapability<TPublic, string, TPath, TValues>;

export function mutation<
  TInput = undefined,
  TPath extends string = string,
  TValues extends object = RouteRequestContextFor<TPath>,
  TResult extends Response | ResponseCapability<TPath, TValues> =
    Response | ResponseCapability<TPath, TValues>,
  TField extends string = string,
  TPublic = MutationResponseData<TResult>,
>(
  options: MutationOptions<TInput, TPath, TValues, TResult, TPublic>,
): MutationCapability<TPublic, TField, TPath, TValues> {
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
          await validateMutationCapability(result, context, options),
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
    TPublic,
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

// The framework serializes a JSON mutation result, so that result crosses the
// browser boundary. A raw Response carries bytes that the application wrote,
// so the framework declares no boundary for it.
async function validateMutationCapability<
  TPath extends string,
  TValues extends object,
>(
  result: Response | ResponseCapability<TPath, TValues>,
  context: HttpRouteContext<TPath, TValues>,
  declaration: DisclosureDeclaration,
) {
  if (result instanceof Response || result.kind !== "json") return result;
  const value = typeof result.value === "function"
    ? await result.value(context)
    : result.value;
  const projected = await projectRouteData({
    data: value,
    declaration,
    kind: "mutation",
    route: context.pathname,
  });
  return { ...result, value: projected };
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
  custom<
    TField extends string = string,
    TInput = unknown,
    TPath extends string = string,
    TValues extends object = RouteRequestContextFor<TPath>,
  >(
    parse: (
      context: HttpRouteContext<TPath, TValues>,
    ) => MaybePromise<TInput>,
  ): TypedMutationInput<TInput, TPath, TValues, TField> {
    // TYPE-EVIDENCE: the brand records parser types and does not require runtime data.
    return parse as TypedMutationInput<TInput, TPath, TValues, TField>;
  },
  form<
    TSchema extends StandardSchemaV1,
    TPath extends string = string,
    TValues extends object = RouteRequestContextFor<TPath>,
  >(
    schema: TSchema,
    map: (
      form: FormData,
      context: HttpRouteContext<TPath, TValues>,
    ) => MaybePromise<StandardSchemaV1.InferInput<TSchema>>,
  ): TypedMutationInput<
    StandardSchemaV1.InferOutput<TSchema>,
    TPath,
    TValues,
    Extract<keyof StandardSchemaV1.InferOutput<TSchema>, string>
  > {
    const parse = async (context: HttpRouteContext<TPath, TValues>) => {
      const form = await context.request.formData();
      const candidate = await map(form, context);
      const result = await schema["~standard"].validate(candidate);
      if (result.issues) {
        throw new MutationValidationError({
          issues: result.issues.map((issue) => ({
            code: "invalid",
            message: issue.message,
            path: normalizeStandardSchemaPath(issue.path),
          })),
        });
      }
      return result.value;
    };
    // TYPE-EVIDENCE: the brand records the verified schema output and field types without adding runtime data.
    return parse as TypedMutationInput<
      StandardSchemaV1.InferOutput<TSchema>,
      TPath,
      TValues,
      Extract<keyof StandardSchemaV1.InferOutput<TSchema>, string>
    >;
  },
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

function normalizeStandardSchemaPath(
  path: StandardSchemaV1.Issue["path"],
): readonly [] | readonly [string, ...(string | number)[]] {
  if (!path) return [];
  const normalized = path.map((segment) =>
    typeof segment === "object" ? segment.key : segment
  );
  if (typeof normalized[0] !== "string") return [];
  if (normalized.some((segment) =>
    typeof segment !== "string" && typeof segment !== "number"
  )) return [];
  // TYPE-EVIDENCE: the checks above prove that the first segment is a string and each remaining segment is a string or number.
  return normalized as [string, ...(string | number)[]];
}

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
