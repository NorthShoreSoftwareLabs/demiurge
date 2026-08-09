import { Readable } from "node:stream";
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from "node:http";

export type ToWebRequestOptions = {
  protocol?: "http" | "https";
};

export function toWebRequest(
  request: IncomingMessage,
  options: ToWebRequestOptions = {},
) {
  const protocol = options.protocol ?? "http";
  const origin = `${protocol}://${request.headers.host ?? "localhost"}`;
  const url = new URL(request.url ?? "/", origin);
  const init: RequestInit & { duplex?: "half" } = {
    headers: toHeaders(request.headers),
    method: request.method,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = Readable.toWeb(request) as ReadableStream;
    init.duplex = "half";
  }

  return new Request(url, init);
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

  await new Promise<void>((resolveWrite, rejectWrite) => {
    Readable.fromWeb(
      webResponse.body as unknown as import("node:stream/web").ReadableStream,
    )
      .on("error", rejectWrite)
      .on("end", resolveWrite)
      .pipe(serverResponse);
  });
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
