import {
  MUTATION_REQUEST_HEADER,
  MUTATION_REQUEST_VALUE,
  MUTATION_RESPONSE_MEDIA_TYPE,
} from "../route";
import {
  href,
  type MutationDataFor,
  type MutationMethodFor,
  type MutationRoute,
  type PathValue,
  type PathVarsFor,
  type RoutePathVars,
} from "../routing";

export type MutationResult<T = unknown> =
  | { version: 1; status: "success"; data?: T; revalidate?: boolean }
  | { version: 1; status: "invalid"; data?: T }
  | { version: 1; status: "redirect"; location: string; history: "push" | "replace" }
  | { version: 1; status: "failed"; message?: string };

export type MutationAction<T = unknown> = (
  previousState: MutationResult<T> | undefined,
  formData: FormData,
) => Promise<MutationResult<T>>;

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

type MutationInvocation<T> = {
  controller: AbortController;
  promise: Promise<MutationResult<T>>;
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
  [TData] extends [never] ? MutationDataFor<TRoute, TMethod> : TData
> {
  type ResultData = [TData] extends [never]
    ? MutationDataFor<TRoute, TMethod>
    : TData;
  let current: MutationInvocation<ResultData> | undefined;

  return (previousState, formData) => {
    current?.controller.abort();
    const controller = new AbortController();
    const invocation: MutationInvocation<ResultData> = {
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
    const request = submitMutation<ResultData>({
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

export async function submitMutation<T = unknown>(options: {
  body: BodyInit;
  contentType?: string;
  method: string;
  signal: AbortSignal;
  url: string;
}) {
  const { result } = await performMutationRequest<T>(options);
  if (!result) {
    throw new Error("Demiurge expected a versioned mutation result.");
  }
  return result;
}

export async function performMutationRequest<T = unknown>(options: {
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
  return { response, result: await readMutationResult<T>(response) };
}

export async function readMutationResult<T = unknown>(response: Response): Promise<MutationResult<T> | undefined> {
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
    if (value.revalidate !== undefined && typeof value.revalidate !== "boolean") throw malformedResult();
    // TYPE-EVIDENCE: T describes application-owned serializable data. The protocol validates its envelope.
    return { version: 1, status: "success", data: value.data as T, ...(value.revalidate === undefined ? {} : { revalidate: value.revalidate }) };
  }
  if (value.status === "invalid") {
    // TYPE-EVIDENCE: T describes application-owned validation data. The protocol validates its envelope.
    return { version: 1, status: "invalid", data: value.data as T };
  }
  if (value.status === "failed") {
    if (value.message !== undefined && typeof value.message !== "string") throw malformedResult();
    return { version: 1, status: "failed", ...(value.message === undefined ? {} : { message: value.message }) };
  }
  if (value.status === "redirect" && typeof value.location === "string" &&
      (value.history === "push" || value.history === "replace")) {
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

function mutationFailure(message: string): MutationResult<never> {
  return { version: 1, status: "failed", message };
}

function malformedResult() {
  return new Error("Demiurge received a malformed mutation result.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
