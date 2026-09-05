import type { HttpRouteContext, MaybePromise } from "../route/types";
import { isPlainObject } from "../type-guards";
import type {
  AuthorizationDecision,
  AuthorizationDenialStatus,
  ResolvedRouteAccess,
  RouteAccessException,
  RouteAccessPolicy,
  RouteAccessSource,
  RouteAuthorizationEntry,
  RouteAuthorizationHook,
} from "./types";

const defaultDenyStatus: AuthorizationDenialStatus = 403;

/**
 * Declares an authorization hook with the request context values that
 * inherited middleware supplies.
 */
export function defineAuthorization<
  TValues extends object = Record<never, never>,
>(
  hook: (
    context: HttpRouteContext<string, TValues>,
  ) => MaybePromise<AuthorizationDecision>,
): RouteAuthorizationHook {
  // TYPE-EVIDENCE: the hook reads the request context values that its own route subtree supplies. The cast labels it with the shared hook shape.
  return hook as RouteAuthorizationHook;
}

/**
 * Reads the access declarations of one cascade, from the root of the route
 * tree to the route file.
 *
 * A declaration adds a restriction. The framework keeps each inherited hook,
 * because a child must not weaken an ancestor. Only an explicit exception
 * removes the inherited hooks.
 */
export function resolveRouteAccess(
  sources: readonly RouteAccessSource[],
): ResolvedRouteAccess {
  const chain: RouteAuthorizationEntry[] = [];
  const exceptions: RouteAccessException[] = [];
  let declared = false;
  let denyStatus = defaultDenyStatus;

  for (const { policy, source } of sources) {
    if (!policy) {
      continue;
    }

    if (policy.replaces) {
      declared = true;
      chain.length = 0;
      exceptions.push({
        ...policy.replaces,
        source: policy.replaces.source ?? source,
      });
    }

    if (policy.public) {
      declared = true;
    }

    if (policy.denyStatus) {
      denyStatus = policy.denyStatus;
    }

    if (policy.authorize) {
      declared = true;
      chain.push({ authorize: policy.authorize, source });
    }
  }

  return {
    chain,
    declared,
    denyStatus,
    exceptions,
    public: declared && chain.length === 0,
  };
}

/**
 * Merges the access declarations that `mergeRoutePolicies` receives.
 */
export function mergeRouteAccess(
  policies: readonly (RouteAccessPolicy | undefined)[],
): ResolvedRouteAccess {
  return resolveRouteAccess(policies.map((policy) => ({ policy })));
}

/**
 * Runs each inherited authorization hook, from the root of the subtree to the
 * route. The function returns a denial response. It returns `null` when every
 * hook permits the request.
 *
 * The framework runs this check before a protected data loader, before a read
 * of a protected cache entry, before a render, and before the effect of a
 * mutation.
 */
export async function authorizeRoute(
  access: ResolvedRouteAccess,
  context: HttpRouteContext<string, object>,
): Promise<Response | null> {
  if (!access.declared) {
    return createAuthorizationDenial(
      access.denyStatus,
      "Forbidden. This route inherits no access declaration.",
    );
  }

  for (const entry of access.chain) {
    let decision: AuthorizationDecision;

    try {
      decision = await entry.authorize(context);
    } catch {
      // A hook that throws denies. The framework never reads a failure as a
      // permission.
      return createAuthorizationDenial(access.denyStatus);
    }

    if (permitsRequest(decision)) {
      continue;
    }

    return createAuthorizationDenial(denialStatus(decision, access.denyStatus));
  }

  return null;
}

/**
 * Reports if one decision permits the request. Each value other than `true`
 * and `{ allow: true }` denies the request.
 */
export function permitsRequest(decision: unknown) {
  if (decision === true) {
    return true;
  }

  return isPlainObject(decision) && decision.allow === true;
}

function denialStatus(
  decision: unknown,
  fallback: AuthorizationDenialStatus,
): AuthorizationDenialStatus {
  if (isPlainObject(decision) && isDenialStatus(decision.status)) {
    return decision.status;
  }

  return fallback;
}

function isDenialStatus(value: unknown): value is AuthorizationDenialStatus {
  return value === 401 || value === 403 || value === 404;
}

function createAuthorizationDenial(
  status: AuthorizationDenialStatus,
  body = denialBody(status),
) {
  // The body names no record and no person, so a denial gives an attacker no
  // information. `no-store` keeps a denial out of each cache.
  return new Response(body, {
    headers: {
      "cache-control": "private, no-store",
      "content-type": "text/plain; charset=utf-8",
    },
    status,
  });
}

function denialBody(status: AuthorizationDenialStatus) {
  if (status === 401) {
    return "Unauthorized.";
  }

  if (status === 404) {
    return "Not Found.";
  }

  return "Forbidden.";
}
