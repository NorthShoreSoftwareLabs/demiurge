export type WebSocketOriginPolicy = {
  allowMissingOrigin?: boolean;
  origins: "same-origin" | readonly string[];
};

export type WebSocketOriginCheck = {
  allowed: boolean;
  expected: "same-origin" | readonly string[];
  origin: string | null;
  reason?: "invalid-origin" | "missing-origin" | "origin-not-allowed";
};

export function checkWebSocketOrigin(
  policy: WebSocketOriginPolicy,
  request: Request,
): WebSocketOriginCheck {
  const origin = request.headers.get("origin");

  if (!origin) {
    return {
      allowed: Boolean(policy.allowMissingOrigin),
      expected: policy.origins,
      origin,
      reason: policy.allowMissingOrigin ? undefined : "missing-origin",
    };
  }

  const normalizedOrigin = normalizeOrigin(origin);

  if (!normalizedOrigin) {
    return {
      allowed: false,
      expected: policy.origins,
      origin,
      reason: "invalid-origin",
    };
  }

  const allowed = isAllowedOrigin(policy, normalizedOrigin, request);

  return {
    allowed,
    expected: policy.origins,
    origin: normalizedOrigin,
    reason: allowed ? undefined : "origin-not-allowed",
  };
}

export function enforceWebSocketOrigin(
  policy: WebSocketOriginPolicy | undefined,
  request: Request,
) {
  if (!policy) {
    return null;
  }

  const check = checkWebSocketOrigin(policy, request);

  if (check.allowed) {
    return null;
  }

  return new Response("WebSocket origin not allowed.", {
    status: 403,
  });
}

function isAllowedOrigin(
  policy: WebSocketOriginPolicy,
  origin: string,
  request: Request,
) {
  if (policy.origins === "same-origin") {
    return origin === new URL(request.url).origin;
  }

  return policy.origins.some((allowedOrigin) =>
    originMatches(allowedOrigin, origin),
  );
}

function originMatches(allowedOrigin: string, actualOrigin: string) {
  if (allowedOrigin === "null") {
    return actualOrigin === "null";
  }

  return normalizeOrigin(allowedOrigin) === actualOrigin;
}

function normalizeOrigin(origin: string) {
  if (origin === "null") {
    return origin;
  }

  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}
