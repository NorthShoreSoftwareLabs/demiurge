import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isIP } from "node:net";
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from "node:http";
import { setRequestConnectionMetadata } from "../server/request-metadata";

export type HttpScheme = "http" | "https";

export type NodeOriginPolicy = {
  allowedHosts: readonly string[];
  trustProxy?: TrustProxy;
};

export type ToWebRequestOptions = NodeOriginPolicy & {
  signal?: AbortSignal;
};

export type TrustProxy =
  | false
  | { hops: number }
  | { ranges: readonly string[] };

const forwardedHeaders = {
  for: "x-forwarded-for",
  host: "x-forwarded-host",
  protocol: "x-forwarded-proto",
} as const satisfies Record<"for" | "host" | "protocol", string>;
const defaultTrustProxy = false satisfies TrustProxy;

// The Fetch specification prohibits these methods in the `Request` constructor.
// `new Request(...)` throws for them. Without this guard, an unauthenticated
// client can make a generic 500 response and add stack traces to the server log.
const forbiddenMethods = new Set(["CONNECT", "TRACE", "TRACK"]);

export class UnsupportedMethodError extends Error {
  method: string;

  constructor(method: string) {
    super(`HTTP method "${method}" is not supported.`);
    this.method = method;
    this.name = "UnsupportedMethodError";
  }
}

export class UntrustedHostError extends Error {
  host: string;

  constructor(host: string) {
    super(`HTTP host "${host}" is not allowed.`);
    this.host = host;
    this.name = "UntrustedHostError";
  }
}

export function validateNodeOriginPolicy(policy: NodeOriginPolicy) {
  if (policy.allowedHosts.length === 0) {
    throw new Error("Demiurge Node allowedHosts must contain at least one host.");
  }

  for (const host of policy.allowedHosts) {
    if (!parseAuthority(host)) {
      throw new Error(`Demiurge Node allowed host "${host}" is invalid.`);
    }
  }

  const trustProxy = policy.trustProxy ?? defaultTrustProxy;

  if (trustProxy === false) {
    return;
  }

  if ("hops" in trustProxy) {
    if (!Number.isSafeInteger(trustProxy.hops) || trustProxy.hops < 0) {
      throw new Error(
        "Demiurge Node trustProxy hop count must be a non-negative integer.",
      );
    }

    return;
  }

  for (const range of trustProxy.ranges) {
    const network = range.split("/")[0];
    ipMatchesRange(network, range);
  }
}

export function toWebRequest(
  request: IncomingMessage,
  options: ToWebRequestOptions,
) {
  validateNodeOriginPolicy(options);
  const method = request.method ?? "GET";

  if (forbiddenMethods.has(method.toUpperCase())) {
    throw new UnsupportedMethodError(method);
  }

  const peerAddress = normalizeIpAddress(request.socket?.remoteAddress);
  const proxy = resolveProxyChain(
    peerAddress,
    request.headers[forwardedHeaders.for],
    options.trustProxy ?? defaultTrustProxy,
  );
  const forwardedProtocol = selectForwardedValue(
    request.headers[forwardedHeaders.protocol],
    proxy.forwardedDepth,
  );
  const protocol = resolveProtocol(request, forwardedProtocol);
  const host = selectForwardedValue(
    request.headers[forwardedHeaders.host],
    proxy.forwardedDepth,
  ) ?? request.headers.host;
  const authority = validateAllowedHost(host, options.allowedHosts);
  const origin = `${protocol}://${authority}`;
  const url = new URL(request.url ?? "/", origin);
  const init: RequestInit & { duplex?: "half" } = {
    headers: toHeaders(request.headers),
    method,
    signal: options.signal,
  };

  if (method !== "GET" && method !== "HEAD") {
    // TYPE-EVIDENCE: Readable.toWeb returns a web stream that matches the DOM ReadableStream body type.
    init.body = Readable.toWeb(request) as ReadableStream;
    init.duplex = "half";
  }

  const webRequest = new Request(url, init);
  setRequestConnectionMetadata(webRequest, { clientIp: proxy.clientIp });

  return webRequest;
}

function resolveProtocol(
  request: IncomingMessage,
  forwardedProtocol: string | undefined,
) {
  if (forwardedProtocol) {
    const protocol = forwardedProtocol.toLowerCase();

    if (protocol !== "http" && protocol !== "https") {
      throw new Error(`Unsupported forwarded protocol "${forwardedProtocol}".`);
    }

    return protocol;
  }

  // TYPE-EVIDENCE: the socket may expose the encrypted flag that Node sets for TLS connections. The cast reads that optional flag.
  return (request.socket as { encrypted?: boolean } | undefined)?.encrypted
    ? "https"
    : "http";
}

function validateAllowedHost(
  host: string | undefined,
  allowedHosts: readonly string[],
) {
  if (allowedHosts.length === 0) {
    throw new Error("Demiurge Node allowedHosts must contain at least one host.");
  }

  if (!host) {
    throw new UntrustedHostError("");
  }

  const authority = parseAuthority(host);

  if (!authority) {
    throw new UntrustedHostError(host);
  }

  const allowed = allowedHosts.some((candidate) => {
    const expected = parseAuthority(candidate);

    if (!expected) {
      throw new Error(`Demiurge Node allowed host "${candidate}" is invalid.`);
    }

    return expected.port
      ? expected.host === authority.host
      : expected.hostname === authority.hostname;
  });

  if (!allowed) {
    throw new UntrustedHostError(host);
  }

  return authority.host;
}

function parseAuthority(value: string) {
  if (value.trim() !== value || value.includes("@")) {
    return null;
  }

  try {
    const parsed = new URL(`http://${value}`);

    if (
      !parsed.hostname ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.host.toLowerCase() !== value.toLowerCase()
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function resolveProxyChain(
  peerAddress: string,
  forwardedFor: string | readonly string[] | undefined,
  trustProxy: TrustProxy,
) {
  const forwarded = headerValues(forwardedFor);
  const chain = [...forwarded, peerAddress];

  if (trustProxy === false) {
    return { clientIp: peerAddress, forwardedDepth: 0 };
  }

  if ("hops" in trustProxy) {
    if (!Number.isSafeInteger(trustProxy.hops) || trustProxy.hops < 0) {
      throw new Error(
        "Demiurge Node trustProxy hop count must be a non-negative integer.",
      );
    }

    const clientHops = Math.min(trustProxy.hops, forwarded.length);

    return {
      clientIp: chain[chain.length - 1 - clientHops],
      forwardedDepth: trustProxy.hops,
    };
  }

  let index = chain.length - 1;
  let trustedHops = 0;

  while (
    index > 0 &&
    isAddressTrusted(chain[index], trustProxy.ranges)
  ) {
    index -= 1;
    trustedHops += 1;
  }

  return {
    clientIp: chain[index],
    forwardedDepth:
      trustedHops || (isAddressTrusted(peerAddress, trustProxy.ranges) ? 1 : 0),
  };
}

function selectForwardedValue(
  header: string | readonly string[] | undefined,
  trustedDepth: number,
) {
  if (trustedDepth === 0) {
    return undefined;
  }

  const values = headerValues(header);

  if (values.length === 0) {
    return undefined;
  }

  return values[Math.max(0, values.length - trustedDepth)];
}

function headerValues(value: string | readonly string[] | undefined) {
  return (Array.isArray(value) ? value : [value])
    .flatMap((item) => item?.split(",") ?? [])
    .map((item) => item.trim())
    .filter(Boolean);
}

function isAddressTrusted(address: string, ranges: readonly string[]) {
  return ranges.some((range) => ipMatchesRange(address, range));
}

function ipMatchesRange(address: string, range: string) {
  const [networkValue, prefixValue] = range.split("/");
  const addressBytes = ipBytes(normalizeIpAddress(address));
  const networkBytes = ipBytes(normalizeIpAddress(networkValue));

  if (!addressBytes || !networkBytes || addressBytes.length !== networkBytes.length) {
    if (!networkBytes) {
      throw new Error(`Demiurge Node trustProxy range "${range}" is invalid.`);
    }

    return false;
  }

  const maximumPrefix = addressBytes.length * 8;
  const prefix = prefixValue === undefined ? maximumPrefix : Number(prefixValue);

  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maximumPrefix) {
    throw new Error(`Demiurge Node trustProxy range "${range}" is invalid.`);
  }

  for (let bit = 0; bit < prefix; bit += 1) {
    const mask = 1 << (7 - (bit % 8));

    if ((addressBytes[Math.floor(bit / 8)] & mask) !==
      (networkBytes[Math.floor(bit / 8)] & mask)) {
      return false;
    }
  }

  return true;
}

function normalizeIpAddress(address: string | undefined) {
  if (!address) {
    return "unknown";
  }

  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

function ipBytes(address: string) {
  const version = isIP(address);

  if (version === 4) {
    return address.split(".").map(Number);
  }

  if (version !== 6) {
    return null;
  }

  const [left = "", right = ""] = address.split("::");
  const leftGroups = left ? left.split(":") : [];
  const rightGroups = right ? right.split(":") : [];
  const missing = 8 - leftGroups.length - rightGroups.length;
  const groups = [
    ...leftGroups,
    ...Array.from({ length: missing }, () => "0"),
    ...rightGroups,
  ];

  return groups.flatMap((group) => {
    const value = Number.parseInt(group, 16);
    return [value >> 8, value & 255];
  });
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
  // or has an error. An aborted client can leave the source stream open. It can
  // also leave an associated file descriptor open. `pipeline` destroys the
  // source when either side closes.
  try {
    // TYPE-EVIDENCE: the DOM body stream matches the Node web stream shape that fromWeb reads.
    await pipeline(
      Readable.fromWeb(
        webResponse.body as import("node:stream/web").ReadableStream,
      ),
      serverResponse,
    );
  } catch (error) {
    if (!isClientDisconnect(error)) {
      throw error;
    }
  }
}

// A client disconnect during a response is ordinary traffic, not a server
// fault. A new throw would run the caller error path for each canceled download.
// This path records a stack trace and creates an unused 500 response. An
// unauthenticated client can cause this condition.
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
  // TYPE-EVIDENCE: the getSetCookie method is a vendor extension present in some server runtimes. The cast reads that optional method for the runtime check.
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
