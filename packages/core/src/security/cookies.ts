import { parseCookieHeader } from "./csrf";

// Cookie prefixes are the one cookie control that the browser enforces without
// server cooperation. A browser refuses a `__Host-` cookie that lacks `Secure`,
// that lacks `Path=/`, or that carries a `Domain` attribute. A browser also
// refuses a `__Secure-` cookie that lacks `Secure`. A refused cookie is
// dropped without a network error, so a mistake looks like a lost session
// rather than a policy failure. These helpers make the invariants explicit and
// report a violation before the response leaves the server.
export type CookieScope = "host" | "none" | "secure";

export type CookieSameSite = "Lax" | "None" | "Strict";

export type SecureCookieDeclaration = {
  domain?: string;
  expires?: Date;
  httpOnly?: boolean;
  maxAge?: number;
  name: string;
  path?: string;
  sameSite?: CookieSameSite;
  scope?: CookieScope;
  secure?: boolean;
  value: string;
};

// The part of a declaration that determines a cookie's identity rather than
// one write's payload. An application declares this once, in a module both
// the route and the client bundle import. It spreads the definition into
// `createSecureCookie({ ...definition, value })` on the server, and passes it
// straight to `readSecureCookie(definition)` on the client. Neither side
// retypes the name or the scope, so a rename in one place changes both.
export type SecureCookieDefinition = Omit<SecureCookieDeclaration, "value">;

export type CookieIssueCode =
  | "cookie-domain-not-allowed"
  | "cookie-max-age-invalid"
  | "cookie-name-carries-prefix"
  | "cookie-name-invalid"
  | "cookie-path-not-allowed"
  | "cookie-same-site-none-requires-secure"
  | "cookie-scope-requires-secure"
  | "cookie-too-large";

export type CookieIssue = {
  code: CookieIssueCode;
  message: string;
  name: string;
};

const namePattern = /^[!#$%&'*+\-.^_`|~A-Za-z0-9]+$/;
const prefixes: Record<CookieScope, string> = {
  host: "__Host-",
  none: "",
  secure: "__Secure-",
};
// Browsers keep about 4096 bytes for one cookie, including the name, the value,
// and the attributes. A larger cookie is dropped without a report.
const maxCookieBytes = 4096;

export function secureCookieName(name: string, scope: CookieScope = "host") {
  return `${prefixes[scope]}${name}`;
}

export function validateSecureCookie(
  declaration: SecureCookieDeclaration,
): CookieIssue[] {
  const scope = declaration.scope ?? "host";
  const name = secureCookieName(declaration.name, scope);
  const issues: CookieIssue[] = [];
  const report = (code: CookieIssueCode, message: string) => {
    issues.push({ code, message, name });
  };

  if (!namePattern.test(declaration.name)) {
    report(
      "cookie-name-invalid",
      `Cookie name ${JSON.stringify(declaration.name)} contains a character that a cookie name cannot hold. Use letters, digits, or the token characters that RFC 6265 allows.`,
    );
  }

  // Demiurge adds the prefix from the declared scope. A name that already holds
  // a prefix is reported, because a silent rename would change the cookie that
  // the application reads back.
  if (
    declaration.name.startsWith("__Host-") ||
    declaration.name.startsWith("__Secure-")
  ) {
    report(
      "cookie-name-carries-prefix",
      `Cookie name ${JSON.stringify(declaration.name)} already carries a prefix. Remove the prefix from name and declare scope ${JSON.stringify(scope === "none" ? "host" : scope)} instead.`,
    );
  }

  if (scope !== "none" && declaration.secure === false) {
    report(
      "cookie-scope-requires-secure",
      `Cookie ${name} uses scope ${JSON.stringify(scope)}, so it requires Secure. Remove secure: false, or declare scope "none" for a cookie that a browser must accept over plain HTTP.`,
    );
  }

  if (scope === "host" && declaration.domain !== undefined) {
    report(
      "cookie-domain-not-allowed",
      `Cookie ${name} uses scope "host", so it cannot carry a Domain attribute. Remove domain, or declare scope "secure" to share the cookie with subdomains.`,
    );
  }

  if (scope === "host" && declaration.path !== undefined && declaration.path !== "/") {
    report(
      "cookie-path-not-allowed",
      `Cookie ${name} uses scope "host", so it requires Path=/. Remove path, or declare scope "secure" for a cookie that a path must limit.`,
    );
  }

  if (declaration.sameSite === "None" && declaration.secure === false) {
    report(
      "cookie-same-site-none-requires-secure",
      `Cookie ${name} declares SameSite=None, so it requires Secure. Remove secure: false, or declare a SameSite policy of "Lax" or "Strict".`,
    );
  }

  if (
    declaration.maxAge !== undefined &&
    (!Number.isInteger(declaration.maxAge) || declaration.maxAge < 0)
  ) {
    report(
      "cookie-max-age-invalid",
      `Cookie ${name} declares maxAge ${JSON.stringify(declaration.maxAge)}. Use a whole number of seconds that is zero or greater.`,
    );
  }

  if (issues.length === 0) {
    const size = new TextEncoder().encode(serialize(declaration, scope, name)).length;

    if (size > maxCookieBytes) {
      report(
        "cookie-too-large",
        `Cookie ${name} serializes to ${size} bytes, and a browser drops a cookie above ${maxCookieBytes} bytes. Store the payload on the server and keep an identifier in the cookie.`,
      );
    }
  }

  return issues;
}

// A page reads a cookie only where the application chose `httpOnly: false`.
// This helper computes the same prefixed name `createSecureCookie` wrote, so
// browser code never hardcodes a `__Host-`/`__Secure-` prefix by hand.
// Pass the same `SecureCookieDefinition` the route spread into
// `createSecureCookie(...)`. A rename or a scope change in that declaration
// then reaches both the write and the read. A bare name is also accepted for
// a cookie with no shared definition. Returns `undefined` outside a browser
// and for a cookie that is absent.
export function readSecureCookie(
  reference: SecureCookieDefinition | string,
  scope: CookieScope = "host",
) {
  if (typeof document === "undefined") {
    return undefined;
  }

  const definition: SecureCookieDefinition =
    typeof reference === "string" ? { name: reference, scope } : reference;

  return parseCookieHeader(document.cookie).get(
    secureCookieName(definition.name, definition.scope ?? "host"),
  );
}

export function createSecureCookie(declaration: SecureCookieDeclaration) {
  const issues = validateSecureCookie(declaration);

  if (issues.length > 0) {
    throw new Error(
      `Demiurge rejected a cookie declaration. ${issues.map((issue) => issue.message).join(" ")}`,
    );
  }

  const scope = declaration.scope ?? "host";

  return serialize(declaration, scope, secureCookieName(declaration.name, scope));
}

function serialize(
  declaration: SecureCookieDeclaration,
  scope: CookieScope,
  name: string,
) {
  // The defaults carry the safe answer. A session cookie stays out of page
  // script, stays on the origin that set it, and travels only over HTTPS. An
  // application opts out of one default at a time, and the opt-out stays
  // visible in the route source.
  const attributes = [`${name}=${encodeURIComponent(declaration.value)}`];
  const path = scope === "host" ? "/" : declaration.path ?? "/";

  attributes.push(`Path=${path}`);

  if (scope !== "host" && declaration.domain !== undefined) {
    attributes.push(`Domain=${declaration.domain}`);
  }

  if (declaration.expires) {
    attributes.push(`Expires=${declaration.expires.toUTCString()}`);
  }

  if (declaration.maxAge !== undefined) {
    attributes.push(`Max-Age=${declaration.maxAge}`);
  }

  attributes.push(`SameSite=${declaration.sameSite ?? "Lax"}`);

  // A JavaScript-readable cookie is the narrow exception. The double-submit
  // CSRF token is the one case that needs it, because page script must copy the
  // token into a request header.
  if (declaration.httpOnly ?? true) {
    attributes.push("HttpOnly");
  }

  if (scope !== "none" || (declaration.secure ?? true)) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}
