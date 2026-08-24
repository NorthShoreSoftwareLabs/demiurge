import {
  MUTATION_REQUEST_HEADER,
  MUTATION_REQUEST_VALUE,
  MUTATION_RESPONSE_MEDIA_TYPE,
  type MutationValidation,
  type MutationValidationIssue,
} from "../route";
import {
  href,
  type MutationDataFor,
  type MutationFieldsFor,
  type MutationMethodFor,
  type MutationRoute,
  type PathValue,
  type PathVarsFor,
  type RoutePathVars,
} from "../routing";
import { useActionState, useMemo } from "react";

const mutationFormActionMetadata = Symbol("Demiurge mutation form action");
declare const mutationFormActionResult: unique symbol;

export type MutationResult<TData = unknown, TField extends string = string> =
  | { version: 1; status: "success"; data?: TData; revalidate?: boolean }
  | { version: 1; status: "invalid"; validation: MutationValidation<TField> }
  | { version: 1; status: "redirect"; location: string; history: "push" | "replace" }
  | { version: 1; status: "failed"; message?: string };

export type MutationAction<TData = unknown, TField extends string = string> = (
  previousState: MutationResult<TData, TField> | undefined,
  formData: FormData,
) => Promise<MutationResult<TData, TField>>;

export type MutationFormAction<TData = unknown, TField extends string = string> =
  ((formData: FormData) => void) & {
    readonly [mutationFormActionMetadata]: {
      method: "POST";
      url: string;
    };
    readonly [mutationFormActionResult]?: MutationResult<TData, TField>;
  };

type MutationActionPath<TRoute extends MutationRoute> =
  TRoute extends keyof RoutePathVars & string
    ? keyof PathVarsFor<TRoute> extends never
      ? { path?: never }
      : { path: PathVarsFor<TRoute> }
    : { path?: Record<string, PathValue> };

export type MutationActionOptions<
  TRoute extends MutationRoute,
  TMethod extends MutationMethodFor<TRoute> = MutationMethodFor<TRoute>,
> = {
  method: TMethod;
  route: TRoute;
} & MutationActionPath<TRoute>;

type MutationRouter = {
  redirect(location: string, history: "push" | "replace", controller: AbortController): void;
  refresh(): Promise<void>;
};

type MutationInvocation<TData, TField extends string> = {
  controller: AbortController;
  promise: Promise<MutationResult<TData, TField>>;
};

let mutationRouter: MutationRouter | undefined;
const pendingMutationControllers = new Set<AbortController>();

export function registerMutationRouter(router: MutationRouter) {
  mutationRouter = router;
  return () => {
    if (mutationRouter === router) mutationRouter = undefined;
  };
}

export function abortMutationActions(except?: AbortController) {
  for (const controller of pendingMutationControllers) {
    if (controller !== except) controller.abort();
  }
}

export function createMutationAction<
  TData = never,
  const TRoute extends MutationRoute = MutationRoute,
  const TMethod extends MutationMethodFor<TRoute> = MutationMethodFor<TRoute>,
>(options: MutationActionOptions<TRoute, TMethod>): MutationAction<
  [TData] extends [never] ? MutationDataFor<TRoute, TMethod> : TData,
  MutationFieldsFor<TRoute, TMethod>
> {
  type ResultData = [TData] extends [never]
    ? MutationDataFor<TRoute, TMethod>
    : TData;
  type ResultField = MutationFieldsFor<TRoute, TMethod>;
  let current: MutationInvocation<ResultData, ResultField> | undefined;

  return (previousState, formData) => {
    current?.controller.abort();
    const controller = new AbortController();
    const invocation: MutationInvocation<ResultData, ResultField> = {
      controller,
      // TYPE-EVIDENCE: the function assigns the promise before it exposes the invocation.
      promise: undefined as never,
    };
    pendingMutationControllers.add(controller);

    // TYPE-EVIDENCE: MutationActionPath applies the same generated path requirement as LinkTo.
    const url = href({
      to: options.route,
      ...(options.path === undefined ? {} : { path: options.path }),
    } as never);
    const request = submitMutation<ResultData, ResultField>({
      body: formData,
      method: options.method,
      signal: controller.signal,
      url,
    });

    invocation.promise = request.then(async (result) => {
      if (current !== invocation) return await current!.promise;
      if (result.status === "redirect") {
        const destination = validateMutationRedirect(result.location);
        if (!destination) return mutationFailure("The mutation returned an unsafe redirect.");
        abortMutationActions(controller);
        mutationRouter?.redirect(destination, result.history, controller);
      } else if (result.status === "success" && result.revalidate) {
        await mutationRouter?.refresh();
      }
      if (controller.signal.aborted) {
        return previousState ?? mutationFailure("The mutation was cancelled.");
      }
      return current === invocation ? result : await current!.promise;
    }).catch(async (error: unknown) => {
      if (current !== invocation) return await current!.promise;
      if (controller.signal.aborted && previousState) return previousState;
      if (controller.signal.aborted) return mutationFailure("The mutation was cancelled.");
      throw error;
    }).finally(() => {
      pendingMutationControllers.delete(controller);
    });
    current = invocation;
    return invocation.promise;
  };
}

export function useMutationAction<
  TData = never,
  const TRoute extends MutationRoute = MutationRoute,
  const TMethod extends MutationMethodFor<TRoute> = MutationMethodFor<TRoute>,
>(
  options: MutationActionOptions<TRoute, TMethod> & { method: TMethod & "POST" },
  initialState?: MutationResult<
    [TData] extends [never] ? MutationDataFor<TRoute, TMethod> : TData,
    MutationFieldsFor<TRoute, TMethod>
  >,
) {
  type ResultData = [TData] extends [never]
    ? MutationDataFor<TRoute, TMethod>
    : TData;
  type ResultField = MutationFieldsFor<TRoute, TMethod>;
  // TYPE-EVIDENCE: MutationActionPath applies the generated path requirement that href expects.
  const url = href({
    to: options.route,
    ...(options.path === undefined ? {} : { path: options.path }),
  } as never);
  const mutation = useMemo(
    () => {
      const generated = createMutationAction(options);
      // TYPE-EVIDENCE: ResultData either keeps the generated data type or applies the caller's explicit data refinement.
      return generated as MutationAction<ResultData, ResultField>;
    },
    [options.method, url],
  );
  const [state, dispatch, pending] = useActionState<
    MutationResult<ResultData, ResultField> | undefined,
    FormData
  >(mutation, initialState);
  const action = useMemo(() => {
    const branded = (formData: FormData) => dispatch(formData);
    Object.defineProperty(branded, mutationFormActionMetadata, {
      value: { method: "POST", url },
    });
    // TYPE-EVIDENCE: the wrapper has the FormData dispatch signature and the metadata property required by MutationFormAction.
    return branded as MutationFormAction<ResultData, ResultField>;
  }, [dispatch, url]);

  return [state, action, pending] as const;
}

export function mutationFormActionDetails(action: MutationFormAction) {
  return action[mutationFormActionMetadata];
}

export async function submitMutation<TData = unknown, TField extends string = string>(options: {
  body: BodyInit;
  contentType?: string;
  method: string;
  signal: AbortSignal;
  url: string;
}) {
  const { result } = await performMutationRequest<TData, TField>(options);
  if (!result) {
    throw new Error("Demiurge expected a versioned mutation result.");
  }
  return result;
}

export async function performMutationRequest<TData = unknown, TField extends string = string>(options: {
  body: BodyInit;
  contentType?: string;
  method: string;
  signal: AbortSignal;
  url: string;
}) {
  const response = await fetch(options.url, {
    body: options.body,
    credentials: "same-origin",
    headers: {
      accept: MUTATION_RESPONSE_MEDIA_TYPE,
      [MUTATION_REQUEST_HEADER]: MUTATION_REQUEST_VALUE,
      ...(options.contentType ? { "content-type": options.contentType } : {}),
    },
    method: options.method,
    redirect: "manual",
    signal: options.signal,
  });
  return { response, result: await readMutationResult<TData, TField>(response) };
}

export async function readMutationResult<TData = unknown, TField extends string = string>(
  response: Response,
): Promise<MutationResult<TData, TField> | undefined> {
  const mediaType = response.headers.get("content-type");
  if (!mediaType) return undefined;
  const [type, ...parameters] = mediaType?.split(";").map((value) => value.trim().toLowerCase()) ?? [];
  const mutationType = MUTATION_RESPONSE_MEDIA_TYPE.split(";")[0];
  if (type !== mutationType) return undefined;
  if (parameters.length !== 1 || parameters[0] !== "v=1") {
    throw new Error("Demiurge received a malformed versioned mutation result.");
  }

  let value: unknown;
  try {
    value = await response.clone().json();
  } catch {
    throw new Error("Demiurge received a malformed versioned mutation result.");
  }
  if (!isRecord(value) || value.version !== 1 || typeof value.status !== "string") {
    throw new Error("Demiurge received a malformed versioned mutation result.");
  }
  if (value.status === "success") {
    if (!hasOnlyKeys(value, ["data", "revalidate", "status", "version"]) ||
        (value.revalidate !== undefined && typeof value.revalidate !== "boolean") ||
        ("data" in value && !isJsonValue(value.data))) throw malformedResult();
    // TYPE-EVIDENCE: TData describes application-owned JSON data. The parser validates the complete value before this assertion.
    return { version: 1, status: "success", ...(value.data === undefined ? {} : { data: value.data as TData }), ...(value.revalidate === undefined ? {} : { revalidate: value.revalidate }) };
  }
  if (value.status === "invalid") {
    if (!hasOnlyKeys(value, ["status", "validation", "version"]) ||
        !isMutationValidation(value.validation)) throw malformedResult();
    // TYPE-EVIDENCE: the parser validates every validation issue and path. TField supplies the application field-name refinement.
    return { version: 1, status: "invalid", validation: value.validation as MutationValidation<TField> };
  }
  if (value.status === "failed") {
    if (!hasOnlyKeys(value, ["message", "status", "version"]) ||
        (value.message !== undefined && typeof value.message !== "string")) throw malformedResult();
    return { version: 1, status: "failed", ...(value.message === undefined ? {} : { message: value.message }) };
  }
  if (value.status === "redirect" && typeof value.location === "string" &&
      (value.history === "push" || value.history === "replace") &&
      hasOnlyKeys(value, ["history", "location", "status", "version"])) {
    return { version: 1, status: "redirect", location: value.location, history: value.history };
  }
  throw malformedResult();
}

export function validateMutationRedirect(location: string) {
  try {
    const destination = new URL(location, window.location.href);
    if (destination.protocol !== window.location.protocol) return undefined;
    if (destination.origin !== window.location.origin) return undefined;
    if (destination.username || destination.password) return undefined;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return undefined;
  }
}

function mutationFailure(message: string): MutationResult<never, never> {
  return { version: 1, status: "failed", message };
}

function malformedResult() {
  return new Error("Demiurge received a malformed mutation result.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isMutationValidation(value: unknown): value is MutationValidation {
  return isRecord(value) && hasOnlyKeys(value, ["issues"]) &&
    Array.isArray(value.issues) && value.issues.every(isMutationValidationIssue);
}

function isMutationValidationIssue(value: unknown): value is MutationValidationIssue {
  return isRecord(value) && hasOnlyKeys(value, ["code", "message", "path"]) &&
    typeof value.code === "string" && typeof value.message === "string" &&
    Array.isArray(value.path) &&
    (value.path.length === 0 || typeof value.path[0] === "string") &&
    value.path.every((part) => typeof part === "string" || typeof part === "number");
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}
