import { resolveCsrf } from "./exceptions";
import type { CsrfPolicy, CsrfPolicyOptions } from "./types";

const unsafeMethods = new Set(["DELETE", "PATCH", "POST", "PUT"]);
const cookieNamePattern = /^[!#$%&'*+\-.^_`|~A-Za-z0-9]+$/;

export type CsrfCookieOptions = {
  cookie?: string;
  secure?: boolean;
};

export type IssuedCsrfToken = {
  cookie: string;
  token: string;
};

export type CsrfClientOptions = {
  cookie?: string;
  field?: string;
  header?: string;
};

const temporaryBrowserTokens = new Map<string, number>();

export function createCsrfToken() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);

  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function createCsrfCookie(
  token: string,
  options: CsrfCookieOptions = {},
) {
  const cookie = options.cookie ?? "csrf-token";

  if (!cookieNamePattern.test(cookie)) {
    throw new Error("Demiurge CSRF cookie name is invalid.");
  }

  if (!token) {
    throw new Error("Demiurge CSRF token must not be empty.");
  }

  const attributes = [
    `${cookie}=${encodeURIComponent(token)}`,
    "Path=/",
    "SameSite=Lax",
  ];

  if (options.secure ?? true) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export function issueCsrfToken(options: CsrfCookieOptions = {}): IssuedCsrfToken {
  const token = createCsrfToken();

  return {
    cookie: createCsrfCookie(token, options),
    token,
  };
}

export async function enforceCsrfProtection(
  policy: CsrfPolicy | undefined,
  request: Request,
) {
  const declared = resolveCsrf(policy);

  if (!unsafeMethods.has(request.method.toUpperCase()) || declared === false) {
    return null;
  }

  const cookieHeader = request.headers.get("cookie");

  // An omitted policy uses the secure default only when browser credentials
  // are present. Explicit `true` remains useful for routes that require a
  // double-submit token regardless of whether another cookie was sent.
  if (
    declared === undefined &&
    !hasNonCsrfCookie(cookieHeader, "csrf-token")
  ) {
    return null;
  }

  const options = normalizeCsrfPolicy(declared ?? true);
  const cookies = parseCookieHeader(cookieHeader);
  const cookieToken = cookies.get(options.cookie);
  const headerToken = request.headers.get(options.header);
  const headerMatches = Boolean(
    cookieToken && headerToken && constantTimeEqual(cookieToken, headerToken),
  );

  if (headerMatches) {
    return null;
  }

  const fieldToken = options.field
    ? await readFormToken(request.clone(), options.field)
    : null;
  const fieldMatches = Boolean(
    cookieToken && fieldToken && constantTimeEqual(cookieToken, fieldToken),
  );

  if (!fieldMatches) {
    return new Response("Invalid CSRF token.", {
      status: 403,
    });
  }

  return null;
}

export async function fetchWithCsrf(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: CsrfClientOptions = {},
) {
  assertSameOriginBrowserRequest(input);
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  for (const [name, value] of new Headers(init.headers)) headers.set(name, value);
  const method = (init.method ?? (input instanceof Request ? input.method : "GET"))
    .toUpperCase();
  const token = unsafeMethods.has(method)
    ? acquireBrowserCsrfToken(options.cookie ?? "csrf-token")
    : undefined;

  if (token) {
    headers.set(options.header ?? "x-csrf-token", token.value);
  }

  try {
    return await fetch(input, {
      ...init,
      credentials: init.credentials ?? "same-origin",
      headers,
    });
  } finally {
    if (token?.temporary) {
      releaseBrowserCsrfToken(options.cookie ?? "csrf-token", token.value);
    }
  }
}

function assertSameOriginBrowserRequest(input: RequestInfo | URL) {
  if (typeof window === "undefined") return;
  const value = input instanceof Request ? input.url : input.toString();
  const url = new URL(value, window.location.href);
  if (url.origin !== window.location.origin) {
    throw new Error("Demiurge CSRF fetch requires a same-origin URL.");
  }
}

export function parseCookieHeader(header: string | null) {
  const cookies = new Map<string, string>();

  if (!header) {
    return cookies;
  }

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (name) {
      cookies.set(name, decodeCookieValue(value));
    }
  }

  return cookies;
}

function normalizeCsrfPolicy(policy: true | CsrfPolicyOptions) {
  if (policy === true) {
    return {
      cookie: "csrf-token",
      field: "_csrf",
      header: "x-csrf-token",
    };
  }

  return {
    cookie: policy.cookie ?? "csrf-token",
    field: policy.field ?? "_csrf",
    header: policy.header ?? "x-csrf-token",
  };
}

function hasNonCsrfCookie(header: string | null, csrfCookie: string) {
  for (const name of parseCookieHeader(header).keys()) {
    if (name !== csrfCookie) return true;
  }
  return false;
}

function acquireBrowserCsrfToken(cookie: string) {
  if (typeof document === "undefined") return undefined;
  const existing = parseCookieHeader(document.cookie).get(cookie);

  if (existing) {
    const key = `${cookie}\0${existing}`;
    const references = temporaryBrowserTokens.get(key);
    if (references !== undefined) temporaryBrowserTokens.set(key, references + 1);
    return { temporary: references !== undefined, value: existing };
  }

  const value = createCsrfToken();
  document.cookie = createCsrfCookie(value, {
    cookie,
    secure: typeof window !== "undefined" && window.location.protocol === "https:",
  });
  temporaryBrowserTokens.set(`${cookie}\0${value}`, 1);
  return { temporary: true, value };
}

function releaseBrowserCsrfToken(cookie: string, value: string) {
  const key = `${cookie}\0${value}`;
  const references = temporaryBrowserTokens.get(key);
  if (references === undefined) return;
  if (references > 1) {
    temporaryBrowserTokens.set(key, references - 1);
    return;
  }
  temporaryBrowserTokens.delete(key);
  if (typeof document === "undefined") return;
  if (parseCookieHeader(document.cookie).get(cookie) !== value) return;
  document.cookie = `${cookie}=; Max-Age=0; Path=/; SameSite=Lax${
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "; Secure"
      : ""
  }`;
}

async function readFormToken(request: Request, field: string) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (
    !contentType.startsWith("application/x-www-form-urlencoded") &&
    !contentType.startsWith("multipart/form-data")
  ) {
    return null;
  }

  try {
    const value = (await request.formData()).get(field);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function decodeCookieValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function constantTimeEqual(left: string, right: string) {
  let diff = left.length ^ right.length;
  const maxLength = Math.max(left.length, right.length);

  for (let index = 0; index < maxLength; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return diff === 0;
}
