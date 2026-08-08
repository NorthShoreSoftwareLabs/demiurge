import type { CsrfPolicy } from "./types";

const unsafeMethods = new Set(["DELETE", "PATCH", "POST", "PUT"]);

export function enforceCsrfProtection(
  policy: CsrfPolicy | undefined,
  request: Request,
) {
  if (!policy || !unsafeMethods.has(request.method.toUpperCase())) {
    return null;
  }

  const options = normalizeCsrfPolicy(policy);
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const cookieToken = cookies.get(options.cookie);
  const headerToken = request.headers.get(options.header);

  if (!cookieToken || !headerToken || !constantTimeEqual(cookieToken, headerToken)) {
    return new Response("Invalid CSRF token.", {
      status: 403,
    });
  }

  return null;
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

function normalizeCsrfPolicy(policy: CsrfPolicy) {
  if (policy === true) {
    return {
      cookie: "csrf-token",
      header: "x-csrf-token",
    };
  }

  return {
    cookie: policy.cookie ?? "csrf-token",
    header: policy.header ?? "x-csrf-token",
  };
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
