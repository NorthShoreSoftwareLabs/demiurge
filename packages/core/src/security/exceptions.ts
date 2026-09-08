import { isPlainObject } from "../type-guards";
import type {
  BodySizeException,
  BodySizeValue,
  ContentSecurityPolicy,
  CspException,
  CsrfException,
  CsrfPolicy,
  CsrfPolicyOptions,
  RequestSecurityPolicy,
  RoutePolicy,
  SecurityException,
  SecurityPolicy,
} from "./types";

/**
 * Reports if a declaration is a typed security exception.
 *
 * An exception carries a `reason` and a `value`. No policy object of the
 * framework uses both names, so the two fields identify the shape.
 */
export function isSecurityException(
  value: unknown,
): value is SecurityException<unknown> {
  return (
    isPlainObject(value) &&
    typeof value.reason === "string" &&
    "value" in value
  );
}

/** Returns the Content-Security-Policy that a document declaration selects. */
export function resolveCsp(
  csp: SecurityPolicy["csp"],
): ContentSecurityPolicy | false | undefined {
  if (isSecurityException(csp)) {
    return false;
  }

  return csp;
}

/** Returns the exception of a document declaration, or `undefined`. */
export function getCspException(
  csp: SecurityPolicy["csp"],
): CspException | undefined {
  // TYPE-EVIDENCE: the exception guard confirms the object carries a reason and a value. The cast labels it as the document exception.
  return isSecurityException(csp) ? csp as CspException : undefined;
}

/** Returns the CSRF policy that a route declaration selects. */
export function resolveCsrf(
  csrf: CsrfPolicy | undefined,
): true | false | CsrfPolicyOptions | undefined {
  if (isSecurityException(csrf)) {
    return false;
  }

  return csrf;
}

/** Returns the exception of a CSRF declaration, or `undefined`. */
export function getCsrfException(
  csrf: CsrfPolicy | undefined,
): CsrfException | undefined {
  // TYPE-EVIDENCE: the exception guard confirms the object carries a reason and a value. The cast labels it as the CSRF exception.
  return isSecurityException(csrf) ? csrf as CsrfException : undefined;
}

/** Returns the request body limit that a route declaration selects. */
export function resolveMaxBodySize(
  maxBodySize: RequestSecurityPolicy["maxBodySize"],
): BodySizeValue | undefined {
  if (isSecurityException(maxBodySize)) {
    // TYPE-EVIDENCE: the exception guard confirms the object carries a value. The cast labels that value as a body size.
    return maxBodySize.value as BodySizeValue;
  }

  return maxBodySize;
}

/** Returns the exception of a body limit declaration, or `undefined`. */
export function getBodySizeException(
  maxBodySize: RequestSecurityPolicy["maxBodySize"],
): BodySizeException | undefined {
  // TYPE-EVIDENCE: the exception guard confirms the object carries a reason and a value. The cast labels it as the body size exception.
  return isSecurityException(maxBodySize)
    ? maxBodySize as BodySizeException
    : undefined;
}

/**
 * Adds the declaring file to each exception of one policy file.
 *
 * The framework merges the policy cascade into one policy, and the merge
 * keeps no file name. This function stamps the file before the merge, so the
 * audit can report the source of each exception.
 */
export function attachExceptionSource(
  policy: RoutePolicy | undefined,
  source: string | undefined,
): RoutePolicy | undefined {
  if (!policy || !source) {
    return policy;
  }

  const document = withDocumentSource(policy.document, source);
  const security = withSecuritySource(policy.security, source);

  if (document === policy.document && security === policy.security) {
    return policy;
  }

  return { ...policy, document, security };
}

function withDocumentSource(
  document: RoutePolicy["document"],
  source: string,
) {
  const exception = getCspException(document?.csp);

  if (!document || !exception || exception.source) {
    return document;
  }

  return { ...document, csp: { ...exception, source } };
}

function withSecuritySource(
  security: RoutePolicy["security"],
  source: string,
) {
  if (!security) {
    return security;
  }

  const csrf = getCsrfException(security.csrf);
  const bodySize = getBodySizeException(security.request?.maxBodySize);

  if ((!csrf || csrf.source) && (!bodySize || bodySize.source)) {
    return security;
  }

  return {
    ...security,
    csrf: csrf && !csrf.source ? { ...csrf, source } : security.csrf,
    request: bodySize && !bodySize.source
      ? { ...security.request, maxBodySize: { ...bodySize, source } }
      : security.request,
  };
}
