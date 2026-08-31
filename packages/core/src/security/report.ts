import {
  limitRequestBody,
  parseBodySize,
  RequestBodyTooLargeError,
} from "./request";
import { isObjectLike } from "../type-guards";

type MaybePromise<T> = Promise<T> | T;

export type SecurityReportPayload = unknown;

export type SecurityReportHandlerOptions = {
  maxBodySize?: number | `${number}${"b" | "gb" | "kb" | "mb"}`;
  onReport?: (
    report: SecurityReportPayload,
    context: SecurityReportContext,
  ) => MaybePromise<void>;
};

export type SecurityReportContext = {
  index: number;
  request: Request;
};

export function createSecurityReportHandler(
  options: SecurityReportHandlerOptions = {},
) {
  return async function handleSecurityReport(request: Request) {
    if (request.method.toUpperCase() !== "POST") {
      return new Response(null, {
        headers: {
          allow: "POST",
        },
        status: 405,
      });
    }

    const contentTypeResponse = enforceReportContentType(request);

    if (contentTypeResponse) {
      return contentTypeResponse;
    }

    const bodySizeResponse = enforceReportBodySize(options, request);

    if (bodySizeResponse) {
      return bodySizeResponse;
    }

    if (options.maxBodySize !== undefined) {
      request = limitRequestBody({ maxBodySize: options.maxBodySize }, request);
    }

    let payload: unknown;

    try {
      payload = await request.json();
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return new Response("Security report body too large.", { status: 413 });
      }

      return new Response("Invalid security report JSON.", {
        status: 400,
      });
    }

    const reports = normalizeSecurityReports(payload);

    for (let index = 0; index < reports.length; index += 1) {
      await options.onReport?.(reports[index], {
        index,
        request,
      });
    }

    return new Response(null, {
      status: 204,
    });
  };
}

const supportedReportContentTypes = new Set([
  "application/csp-report",
  "application/reports+json",
]);

function enforceReportContentType(request: Request) {
  const value = request.headers.get("content-type");

  // Keep direct/programmatic calls compatible. Browser-generated reports
  // always send one of the two media types below.
  if (!value) {
    return null;
  }

  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();

  if (mediaType && supportedReportContentTypes.has(mediaType)) {
    return null;
  }

  return new Response("Unsupported security report Content-Type.", {
    status: 415,
  });
}

function enforceReportBodySize(
  options: SecurityReportHandlerOptions,
  request: Request,
) {
  if (options.maxBodySize === undefined) {
    return null;
  }

  const contentLength = request.headers.get("content-length");

  if (!contentLength) {
    return null;
  }

  if (!/^\d+$/.test(contentLength)) {
    return new Response("Invalid Content-Length.", {
      status: 400,
    });
  }

  const declaredSize = Number(contentLength);

  if (!Number.isSafeInteger(declaredSize)) {
    return new Response("Invalid Content-Length.", {
      status: 400,
    });
  }

  if (declaredSize > parseBodySize(options.maxBodySize)) {
    return new Response("Security report body too large.", {
      status: 413,
    });
  }

  return null;
}

function normalizeSecurityReports(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (isObjectLike(payload) && "csp-report" in payload) {
    return [payload["csp-report"]];
  }

  return [payload];
}
