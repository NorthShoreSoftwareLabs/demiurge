import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from "node:http";

export type ToWebRequestOptions = {
  protocol?: "http" | "https";
};

// The Fetch spec forbids these on the `Request` constructor, so `new
// Request(...)` throws for them. Left unguarded, every one of these requests
// reached the generic 500 path: an unauthenticated client could throw at
// will and fill the server log with a stack trace per request.
const forbiddenMethods = new Set(["CONNECT", "TRACE", "TRACK"]);

export class UnsupportedMethodError extends Error {
  method: string;

  constructor(method: string) {
    super(`HTTP method "${method}" is not supported.`);
    this.method = method;
    this.name = "UnsupportedMethodError";
  }
}

export function toWebRequest(
  request: IncomingMessage,
  options: ToWebRequestOptions = {},
) {
  const method = request.method ?? "GET";

  if (forbiddenMethods.has(method.toUpperCase())) {
    throw new UnsupportedMethodError(method);
  }

  const protocol = options.protocol ?? "http";
  const origin = `${protocol}://${request.headers.host ?? "localhost"}`;
  const url = new URL(request.url ?? "/", origin);
  const init: RequestInit & { duplex?: "half" } = {
    headers: toHeaders(request.headers),
    method,
  };

  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(request) as ReadableStream;
    init.duplex = "half";
  }

  return new Request(url, init);
}

// Shared by the Node adapter and the Vite dev middleware so a request the
// Fetch layer cannot represent gets the same answer in both.
export function writeNotImplemented(serverResponse: ServerResponse) {
  serverResponse.statusCode = 501;
  serverResponse.setHeader("content-type", "text/plain; charset=utf-8");
  serverResponse.end("Not Implemented");
}

export async function writeWebResponse(
  serverResponse: ServerResponse,
  webResponse: Response,
) {
  // `Headers.forEach` joins repeated headers with a comma, which is wrong for
  // `set-cookie`: two cookies would arrive as one malformed header. Node's
  // `setHeader` takes an array for exactly this case.
  const cookies = getSetCookies(webResponse.headers);

  webResponse.headers.forEach((value, name) => {
    if (name === "set-cookie") {
      return;
    }

    serverResponse.setHeader(name, value);
  });

  if (cookies.length > 0) {
    serverResponse.setHeader("set-cookie", cookies);
  }

  serverResponse.statusCode = webResponse.status;

  // An empty status text would otherwise overwrite Node's default reason
  // phrase with nothing at all.
  if (webResponse.statusText) {
    serverResponse.statusMessage = webResponse.statusText;
  }

  if (!webResponse.body) {
    serverResponse.end();
    return;
  }

  // `Readable.pipe()` does not destroy its source when the destination closes
  // or errors, so an aborted client leaves the source stream — and any file
  // descriptor behind it, such as the static handler's `createReadStream` —
  // open indefinitely. `pipeline` destroys the source on either side closing.
  try {
    await pipeline(
      Readable.fromWeb(
        webResponse.body as unknown as import("node:stream/web").ReadableStream,
      ),
      serverResponse,
    );
  } catch (error) {
    if (!isClientDisconnect(error)) {
      throw error;
    }
  }
}

// A client that hangs up part-way through a response is ordinary traffic, not
// a server fault. Rethrowing here would run the caller's error path — a logged
// stack trace and a 500 nobody is left to read — for every cancelled image or
// abandoned download, which any unauthenticated client can trigger at will.
const clientDisconnectCodes = new Set([
  "ECONNRESET",
  "EPIPE",
  "ERR_STREAM_DESTROYED",
  "ERR_STREAM_PREMATURE_CLOSE",
]);

function isClientDisconnect(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    clientDisconnectCodes.has(error.code)
  );
}

export function toHeaders(headers: IncomingHttpHeaders) {
  const nextHeaders = new Headers();

  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        nextHeaders.append(name, item);
      }
      continue;
    }

    if (value) {
      nextHeaders.set(name, value);
    }
  }

  return nextHeaders;
}

function getSetCookies(headers: Headers) {
  const getSetCookie = (headers as Headers & {
    getSetCookie?: () => string[];
  }).getSetCookie;

  if (getSetCookie) {
    return getSetCookie.call(headers);
  }

  const combined = headers.get("set-cookie");

  return combined ? splitSetCookies(combined) : [];
}

function splitSetCookies(value: string) {
  return value.split(/,\s*(?=[^;,=\s]+\s*=)/);
}
