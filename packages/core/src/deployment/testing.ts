// A deployment conformance kit proves the provider translation and the
// production artifact, not the framework. The adapter contract in
// `../adapter/testing` proves an adapter's in-process behavior against a
// `Request`/`Response` pair it controls. A deployment sits one layer further
// out: a real process, behind a real provider, answering real HTTP. The
// probes here run against a live origin, and each one proves one behavior a
// deployment integration can claim to support.
//
// Every integration selects only the probes that its execution model
// supports. A process runtime can prove `readiness`. A platform that recycles
// instances between requests cannot. The claims map keeps that selection
// honest the same way the adapter contract does. A probe with no matching
// claim, or a claim with no matching probe, fails the suite.

type MaybePromise<T> = T | Promise<T>;

export type DeploymentCapability =
  | "clientAddress"
  | "readiness"
  | "repeatedHeaders"
  | "requestUrl"
  | "securityHeaders"
  | "sharedCache"
  | "staticAssets"
  | "streaming";

export type DeploymentClaims = Record<DeploymentCapability, boolean>;

export type DeploymentReadinessHost = {
  afterShutdown: () => MaybePromise<Response>;
  ready: () => MaybePromise<Response>;
  shutdown: () => MaybePromise<void>;
};

export type DeploymentSharedCacheHost = {
  readFromPeer: (key: string) => MaybePromise<Response>;
  writeFromOrigin: (key: string, value: string) => MaybePromise<Response>;
};

// One probe per capability. A probe reaches the deployment the way a real
// client would, over the network, and the contract reads the result. Every
// probe may be called more than once.
export type DeploymentContractProbes = {
  clientAddress?: (forwardedFor: string) => MaybePromise<Response>;
  readiness?: () => MaybePromise<DeploymentReadinessHost>;
  repeatedHeaders?: () => MaybePromise<Response>;
  requestUrl?: (pathname: string, search: string) => MaybePromise<Response>;
  securityHeaders?: () => MaybePromise<Response>;
  sharedCache?: () => MaybePromise<DeploymentSharedCacheHost>;
  staticAssets?: () => MaybePromise<Response>;
  streaming?: () => MaybePromise<Response>;
};

const contractCapabilities = [
  "clientAddress",
  "readiness",
  "repeatedHeaders",
  "requestUrl",
  "securityHeaders",
  "sharedCache",
  "staticAssets",
  "streaming",
] as const satisfies readonly DeploymentCapability[];

const noncePattern = /'nonce-([^']+)'/;

export async function verifyDeploymentContract(
  claims: DeploymentClaims,
  probes: DeploymentContractProbes,
) {
  for (const capability of contractCapabilities) {
    const declared = claims[capability];
    const probe = probes[capability];

    assert(
      typeof declared === "boolean",
      `a deployment must declare capability "${capability}" as a boolean`,
    );
    assert(
      !declared || Boolean(probe),
      `capability "${capability}" is declared true and needs a probe that proves it`,
    );
    assert(
      declared || !probe,
      `capability "${capability}" has a probe but the deployment declares it false`,
    );
  }

  if (probes.requestUrl) {
    await verifyRequestUrlContract(probes.requestUrl);
  }

  if (probes.clientAddress) {
    await verifyClientAddressContract(probes.clientAddress);
  }

  if (probes.streaming) {
    await verifyStreamingContract(probes.streaming);
  }

  if (probes.repeatedHeaders) {
    await verifyRepeatedHeadersContract(probes.repeatedHeaders);
  }

  if (probes.staticAssets) {
    await verifyStaticAssetsContract(probes.staticAssets);
  }

  if (probes.securityHeaders) {
    await verifySecurityHeadersContract(probes.securityHeaders);
  }

  if (probes.sharedCache) {
    await verifySharedCacheContract(probes.sharedCache);
  }

  if (probes.readiness) {
    await verifyReadinessContract(probes.readiness);
  }
}

// A provider sits in front of the process and rewrites the request before
// the application ever sees it. The pathname and query string the
// application reports back must be the ones the client asked for. Not an
// internal rewrite target, a proxy's own path, or a stale default.
async function verifyRequestUrlContract(
  probe: NonNullable<DeploymentContractProbes["requestUrl"]>,
) {
  const pathname = "/deployment-contract/request-url-probe";
  const search = `?probe=${Date.now()}`;
  const response = await probe(pathname, search);
  const reported = await readJson(response, "the request-url probe");

  assert(
    reported.pathname === pathname,
    `the deployment must report the client's request pathname, and it reported ${JSON.stringify(reported.pathname)} instead of ${JSON.stringify(pathname)}`,
  );
  assert(
    reported.search === search,
    `the deployment must report the client's request query string, and it reported ${JSON.stringify(reported.search)} instead of ${JSON.stringify(search)}`,
  );
}

// A provider terminates the client's TCP connection and forwards the request
// over its own connection to the process. Without a forwarded-header
// translation, every request would appear to originate from the provider
// itself instead of the client that sent it.
async function verifyClientAddressContract(
  probe: NonNullable<DeploymentContractProbes["clientAddress"]>,
) {
  const first = `203.0.113.${1 + Math.floor(Math.random() * 200)}`;
  const second = `198.51.100.${1 + Math.floor(Math.random() * 200)}`;
  const firstReported = await readJson(await probe(first), "the client-address probe");
  const secondReported = await readJson(await probe(second), "the client-address probe");

  assert(
    firstReported.address === first,
    `the deployment must translate the forwarded client address, and it reported ${JSON.stringify(firstReported.address)} instead of ${JSON.stringify(first)}`,
  );
  assert(
    secondReported.address === second,
    `the deployment must translate the forwarded client address, and it reported ${JSON.stringify(secondReported.address)} instead of ${JSON.stringify(second)}`,
  );
}

// A streamed body reaches the client before the render finishes, so it
// arrives as more than one chunk. A provider that buffers the whole response
// before forwarding it fails this, even when the application itself streams.
async function verifyStreamingContract(
  probe: NonNullable<DeploymentContractProbes["streaming"]>,
) {
  const response = await probe();

  assert(
    Boolean(response.body),
    "a streaming response must expose a readable body stream",
  );

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let chunks = 0;
  let body = "";

  while (true) {
    const chunk = await reader.read();

    if (chunk.done) {
      break;
    }

    chunks += 1;
    body += decoder.decode(chunk.value, { stream: true });
  }

  body += decoder.decode();

  assert(body.length > 0, "a streaming response must deliver a body");
  assert(
    chunks > 1,
    "a streaming response must deliver its body in more than one chunk",
  );

  const cancelled = await probe();

  try {
    await cancelled.body?.cancel();
  } catch (error) {
    throw contractError(
      `a streaming response body must accept cancellation, and it failed with ${describe(error)}`,
    );
  }
}

// A provider that folds multiple response headers of the same name into one
// comma-joined value corrupts `Set-Cookie`. It is defined to never combine
// that way. This probe proves the deployment forwards repeated headers as
// distinct values instead of merging them.
async function verifyRepeatedHeadersContract(
  probe: NonNullable<DeploymentContractProbes["repeatedHeaders"]>,
) {
  const response = await probe();
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];

  assert(
    cookies.length >= 2,
    `a deployment must forward every Set-Cookie header as a distinct value, and it reported ${cookies.length}`,
  );

  const names = cookies.map((cookie) => cookie.split("=")[0]);

  assert(
    new Set(names).size === names.length,
    "a deployment must forward every declared cookie without dropping or duplicating one",
  );
}

// A static asset served through the production artifact must stay byte
// identical across requests and carry the long-lived, immutable cache header
// a fingerprinted filename promises. A provider that regenerates or
// revalidates the asset on every request breaks that promise even when the
// bytes still match.
async function verifyStaticAssetsContract(
  probe: NonNullable<DeploymentContractProbes["staticAssets"]>,
) {
  const first = await probe();

  assert(first.ok, `a static asset request must succeed, and it returned ${first.status}`);

  const cacheControl = (first.headers.get("cache-control") ?? "").toLowerCase();

  assert(
    cacheControl.includes("immutable") && cacheControl.includes("max-age"),
    `a fingerprinted static asset must carry an immutable, long-lived cache-control header, and it carried ${JSON.stringify(cacheControl)}`,
  );

  const firstBody = await first.text();
  const second = await probe();
  const secondBody = await second.text();

  assert(
    firstBody === secondBody,
    "a repeated static asset request must return the same bytes",
  );
}

// A nonce is single use. Two responses cannot share one, and the document
// must carry the value the header declares. Security headers that protect
// against framing or MIME sniffing must survive the trip through the
// provider unchanged.
async function verifySecurityHeadersContract(
  probe: NonNullable<DeploymentContractProbes["securityHeaders"]>,
) {
  const first = await probe();
  const second = await probe();
  const firstNonce = readCspNonce(first);
  const secondNonce = readCspNonce(second);

  assert(
    Boolean(firstNonce),
    "a security-headers response must declare a content-security-policy nonce source",
  );
  assert(
    Boolean(secondNonce) && secondNonce !== firstNonce,
    "every response must carry a freshly generated nonce",
  );

  const document = await first.text();

  assert(
    document.includes(`nonce="${firstNonce}"`),
    "the rendered document must carry the nonce its header declares",
  );
  await second.body?.cancel();

  assert(
    (first.headers.get("x-content-type-options") ?? "").toLowerCase() === "nosniff",
    "a security-headers response must carry x-content-type-options nosniff",
  );
}

// A cache is shared, not per instance, when a write on one instance is
// visible from another. This is the one probe in the suite that reaches two
// separate connections into the deployment. It is the only behavior a
// single connection cannot distinguish from an in-process cache.
async function verifySharedCacheContract(
  probe: NonNullable<DeploymentContractProbes["sharedCache"]>,
) {
  const host = await probe();
  const key = `deployment-contract-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const value = `shared-cache-probe-${Math.random().toString(36).slice(2)}`;

  const write = await host.writeFromOrigin(key, value);

  assert(
    write.ok,
    `writing to the shared cache must succeed, and it returned ${write.status}`,
  );

  const read = await host.readFromPeer(key);
  const readBody = await read.text();

  assert(
    read.ok,
    `reading the shared cache from a peer instance must succeed, and it returned ${read.status}`,
  );
  assert(
    readBody === value,
    `a value written to the shared cache must be visible from another instance, and it read ${JSON.stringify(readBody)} instead of ${JSON.stringify(value)}`,
  );
}

// Readiness and graceful shutdown apply only to a process runtime, one that
// keeps running between requests and can be told to drain. Shutdown must
// stop accepting new traffic and the readiness probe must reflect that
// before the process exits.
async function verifyReadinessContract(
  probe: NonNullable<DeploymentContractProbes["readiness"]>,
) {
  const host = await probe();
  const ready = await host.ready();

  assert(
    ready.ok,
    `the readiness probe must succeed before shutdown, and it returned ${ready.status}`,
  );

  await host.shutdown();
  await host.shutdown();

  const afterShutdown = await host.afterShutdown();

  assert(
    !afterShutdown.ok,
    `the readiness probe must stop reporting ready once shutdown starts, and it returned ${afterShutdown.status}`,
  );
}

async function readJson(response: Response, requirement: string) {
  try {
    // TYPE-EVIDENCE: json() returns unknown. The contract only reads string fields it names itself, and the assertions below fail loudly for a missing or wrong-typed field.
    return (await response.json()) as Record<string, string>;
  } catch (error) {
    throw contractError(
      `${requirement} must return a JSON body, and it failed with ${describe(error)}`,
    );
  }
}

function readCspNonce(response: Response) {
  const csp = response.headers.get("content-security-policy") ?? "";

  return noncePattern.exec(csp)?.[1];
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function assert(condition: boolean, requirement: string): asserts condition {
  if (!condition) {
    throw contractError(requirement);
  }
}

function contractError(requirement: string) {
  return new Error(`Deployment contract failed: ${requirement}.`);
}
