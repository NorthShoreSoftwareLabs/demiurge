import type { HttpMethod } from "../route/types";
import type { RequestSecurityPolicy } from "./types";
import { copyRequestConnectionMetadata } from "../server/request-metadata";

const byteUnits = {
  b: 1,
  gb: 1024 ** 3,
  kb: 1024,
  mb: 1024 ** 2,
} as const;

export function enforceRequestSecurity(
  policy: RequestSecurityPolicy | undefined,
  request: Request,
  method: HttpMethod,
) {
  const methodResponse = enforceAllowedMethods(policy, method);

  if (methodResponse) {
    return methodResponse;
  }

  if (policy?.maxBodySize === undefined) {
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

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Demiurge request body exceeded maxBodySize while being read.");
    this.name = "RequestBodyTooLargeError";
  }
}

export function limitRequestBody(
  policy: RequestSecurityPolicy | undefined,
  request: Request,
) {
  if (policy?.maxBodySize === undefined || request.body === null) {
    return request;
  }

  const maximumBytes = parseBodySize(policy.maxBodySize);
  const reader = request.body.getReader();
  let bytesRead = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const result = await reader.read();

      if (result.done) {
        controller.close();
        return;
      }

      bytesRead += result.value.byteLength;

      if (bytesRead > maximumBytes) {
        const error = new RequestBodyTooLargeError();
        controller.error(error);

        try {
          await reader.cancel(error);
        } catch {
          // The size error is authoritative even if the source rejects cancel.
        }

        return;
      }

      controller.enqueue(result.value);
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } catch {
        // The downstream cancellation has already completed.
      }
    },
  });

  // SAFETY: the duplex field is a runtime extension required for stream request bodies. The cast adds it to the standard init type.
  const limitedRequest = new Request(request, {
    body,
    duplex: "half",
  } as RequestInit);
  copyRequestConnectionMetadata(request, limitedRequest);

  return limitedRequest;
}

export function requestBodyTooLargeResponse() {
  return new Response("Request body too large.", { status: 413 });
}

export function enforceAllowedMethods(
  policy: RequestSecurityPolicy | undefined,
  method: HttpMethod,
) {
  if (!policy?.allowedMethods) {
    return null;
  }

  if (isAllowedMethod(policy.allowedMethods, method)) {
    return null;
  }

  return new Response(null, {
    headers: {
      allow: allowedMethodsHeader(policy.allowedMethods),
    },
    status: 405,
  });
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
  // SAFETY: the regex restricts the unit to a byte size suffix. The lowercase value is therefore a key of the byte units map.
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

function isAllowedMethod(
  allowedMethods: readonly HttpMethod[],
  method: HttpMethod,
) {
  return (
    allowedMethods.includes(method) ||
    (method === "HEAD" && allowedMethods.includes("GET"))
  );
}

function allowedMethodsHeader(allowedMethods: readonly HttpMethod[]) {
  const methods = [...allowedMethods];

  if (methods.includes("GET") && !methods.includes("HEAD")) {
    methods.push("HEAD");
  }

  return methods.join(", ");
}
