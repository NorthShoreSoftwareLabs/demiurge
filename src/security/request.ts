import type { RequestSecurityPolicy } from "./types";

const byteUnits = {
  b: 1,
  gb: 1024 ** 3,
  kb: 1024,
  mb: 1024 ** 2,
} as const;

export function enforceRequestSecurity(
  policy: RequestSecurityPolicy | undefined,
  request: Request,
) {
  if (!policy?.maxBodySize) {
    return null;
  }

  const contentLength = request.headers.get("content-length");

  if (!contentLength) {
    return null;
  }

  const declaredSize = parseContentLength(contentLength);

  if (declaredSize === null) {
    return new Response("Invalid Content-Length.", {
      status: 400,
    });
  }

  const maxBodySize = parseBodySize(policy.maxBodySize);

  if (declaredSize > maxBodySize) {
    return new Response("Request body too large.", {
      status: 413,
    });
  }

  return null;
}

export function parseBodySize(value: number | string) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("Demiurge request maxBodySize must be a non-negative integer.");
    }

    return value;
  }

  const match = /^(\d+)(b|kb|mb|gb)$/i.exec(value.trim());

  if (!match) {
    throw new Error(
      "Demiurge request maxBodySize must use bytes or a b/kb/mb/gb suffix.",
    );
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase() as keyof typeof byteUnits;
  const size = amount * byteUnits[unit];

  if (!Number.isSafeInteger(size)) {
    throw new Error("Demiurge request maxBodySize is too large.");
  }

  return size;
}

function parseContentLength(value: string) {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const contentLength = Number(value);
  return Number.isSafeInteger(contentLength) ? contentLength : null;
}
