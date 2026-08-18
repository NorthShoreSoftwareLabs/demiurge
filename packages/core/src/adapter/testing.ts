import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  verifyCacheStoreContract,
  verifyCacheStoreRefreshContract,
  type CacheStoreFactory,
} from "../data/testing";
import type { Adapter, AdapterCapability } from "./index";

type MaybePromise<T> = T | Promise<T>;

// A host answers a protocol upgrade before it has an HTTP response body, and
// the Response constructor rejects status 101. A handshake is reported as a
// plain status and header pair instead.
export type AdapterUpgradeResult = {
  headers?: Record<string, string>;
  status: number;
};

export type AdapterBackgroundHost = {
  shutdown: () => Promise<void>;
  waitUntil: (promise: Promise<unknown>) => void;
};

export type AdapterStaticOutputEntry = {
  file: string;
  headers: Record<string, string>;
  pathname: string;
};

export type AdapterStaticOutput = {
  entries: readonly AdapterStaticOutputEntry[];
};

// One probe per capability. A probe runs the adapter through the smallest
// deployment that can prove the capability, and the contract reads the result.
// Every probe may be called more than once.
export type AdapterContractProbes = {
  backgroundLifetime?: () => MaybePromise<AdapterBackgroundHost>;
  crossOriginIsolationHeaders?: () => MaybePromise<Response>;
  nonceInjection?: () => MaybePromise<Response>;
  sharedCache?: CacheStoreFactory;
  staticOutput?: (outDir: string) => MaybePromise<AdapterStaticOutput>;
  streaming?: () => MaybePromise<Response>;
  webSocket?: (request: Request) => MaybePromise<AdapterUpgradeResult>;
  webTransport?: (request: Request) => MaybePromise<AdapterUpgradeResult>;
};

export const adapterContractOrigin = "https://adapter.contract.test";

const foreignOrigin = "https://foreign.contract.test";

const contractCapabilities = [
  "backgroundLifetime",
  "crossOriginIsolationHeaders",
  "nonceInjection",
  "sharedCache",
  "staticOutput",
  "streaming",
  "webSocket",
  "webTransport",
] as const satisfies readonly AdapterCapability[];

const noncePattern = /'nonce-([^']+)'/;

export async function verifyAdapterContract(
  adapter: Adapter,
  probes: AdapterContractProbes,
) {
  assert(
    typeof adapter.name === "string" && adapter.name.length > 0,
    "an adapter must carry a name",
  );

  for (const capability of contractCapabilities) {
    const declared = adapter.capabilities[capability];
    const probe = probes[capability];

    assert(
      typeof declared === "boolean",
      `an adapter must declare capability "${capability}" as a boolean`,
    );
    assert(
      !declared || Boolean(probe),
      `capability "${capability}" is declared true and needs a probe that proves it`,
    );
    assert(
      declared || !probe,
      `capability "${capability}" has a probe but the adapter declares it false`,
    );
  }

  if (probes.backgroundLifetime) {
    await verifyBackgroundLifetimeContract(probes.backgroundLifetime);
  }

  if (probes.crossOriginIsolationHeaders) {
    await verifyCrossOriginIsolationContract(probes.crossOriginIsolationHeaders);
  }

  if (probes.nonceInjection) {
    await verifyNonceInjectionContract(probes.nonceInjection);
  }

  if (probes.sharedCache) {
    await verifySharedCacheContract(probes.sharedCache);
  }

  if (probes.staticOutput) {
    await verifyStaticOutputContract(probes.staticOutput);
  }

  if (probes.streaming) {
    await verifyStreamingContract(probes.streaming);
  }

  if (probes.webSocket) {
    await verifyUpgradeContract(probes.webSocket, "websocket", 101);
  }

  if (probes.webTransport) {
    await verifyUpgradeContract(probes.webTransport, "webtransport", 200);
  }
}

// A streamed body reaches the client before the render finishes, so it arrives
// as more than one chunk. A buffered response fails this, and a client that
// disconnects early must not fault the host.
async function verifyStreamingContract(
  probe: NonNullable<AdapterContractProbes["streaming"]>,
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

// A nonce is single use. Two responses cannot share one, the document must
// carry the value the header declares, and a shared cache must not store it.
async function verifyNonceInjectionContract(
  probe: NonNullable<AdapterContractProbes["nonceInjection"]>,
) {
  const first = await probe();
  const second = await probe();
  const firstNonce = readCspNonce(first);
  const secondNonce = readCspNonce(second);

  await second.body?.cancel();

  assert(
    Boolean(firstNonce),
    "a nonce-injecting response must declare a content-security-policy nonce source",
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

  const cacheControl = (first.headers.get("cache-control") ?? "").toLowerCase();

  assert(
    cacheControl.includes("no-store") || cacheControl.includes("private"),
    "a nonce-backed document must not be a shared cache representation",
  );
}

// Cross-origin isolation needs both headers to survive the host response path.
// A resource policy travels with them and keeps the isolated document from
// leaking as a subresource.
async function verifyCrossOriginIsolationContract(
  probe: NonNullable<AdapterContractProbes["crossOriginIsolationHeaders"]>,
) {
  const response = await probe();
  const embedderPolicy = response.headers.get("cross-origin-embedder-policy");

  await response.body?.cancel();

  assert(
    response.headers.get("cross-origin-opener-policy") === "same-origin",
    "an isolated response must carry cross-origin-opener-policy same-origin",
  );
  assert(
    embedderPolicy === "require-corp" || embedderPolicy === "credentialless",
    "an isolated response must carry cross-origin-embedder-policy require-corp or credentialless",
  );
  assert(
    Boolean(response.headers.get("cross-origin-resource-policy")),
    "an isolated response must carry a cross-origin-resource-policy",
  );
}

// Background work outlives the response that started it. Shutdown waits for
// that work, a failed task never fails shutdown, and a repeated shutdown is
// safe.
async function verifyBackgroundLifetimeContract(
  probe: NonNullable<AdapterContractProbes["backgroundLifetime"]>,
) {
  const host = await probe();
  let release = () => {};
  let settled = false;
  const work = new Promise<void>((resolveWork) => {
    release = () => {
      settled = true;
      resolveWork();
    };
  });

  host.waitUntil(work);

  let stopped = false;
  const shutdown = host.shutdown().then(() => {
    stopped = true;
  });

  await tick();

  assert(
    !stopped,
    "shutdown must not complete while background work is pending",
  );

  release();
  await shutdown;

  assert(
    settled && stopped,
    "shutdown must complete once background work settles",
  );

  const failingHost = await probe();
  failingHost.waitUntil(
    Promise.reject(new Error("Adapter contract background failure.")),
  );

  try {
    await failingHost.shutdown();
    await failingHost.shutdown();
  } catch (error) {
    throw contractError(
      `failed background work must not fail shutdown, and it failed with ${describe(error)}`,
    );
  }
}

// A shared cache is the framework cache store contract seen from a host. The
// refresh contract applies to a store that publishes the lease methods.
async function verifySharedCacheContract(
  probe: NonNullable<AdapterContractProbes["sharedCache"]>,
) {
  await verifyCacheStoreContract(probe);

  const store = await probe();

  if (store.acquireRefreshLease) {
    await verifyCacheStoreRefreshContract(probe);
  }
}

// A build artifact is a file on disk, and it holds no per-request state. The
// same build run twice writes the same files, which is what makes a deployment
// reproducible.
async function verifyStaticOutputContract(
  probe: NonNullable<AdapterContractProbes["staticOutput"]>,
) {
  const outDir = await mkdtemp(join(tmpdir(), "demiurge-adapter-contract-"));

  try {
    const first = await probe(outDir);

    assert(
      first.entries.length > 0,
      "a static build must produce at least one output entry",
    );

    const files = new Set<string>();
    const pathnames = new Set<string>();
    const contents = new Map<string, string>();

    for (const entry of first.entries) {
      const file = JSON.stringify(entry.file);

      assert(
        isContainedFile(entry.file),
        `every output file must stay inside the output directory, and ${file} does not`,
      );
      assert(
        !files.has(entry.file),
        `every output entry must own one file, and ${file} repeats`,
      );
      assert(
        !pathnames.has(entry.pathname),
        `every output entry must own one pathname, and ${JSON.stringify(entry.pathname)} repeats`,
      );

      files.add(entry.file);
      pathnames.add(entry.pathname);

      const headers = lowercaseHeaders(entry.headers);

      assert(
        headers["set-cookie"] === undefined,
        `a build artifact must not carry per-request state, and ${file} sets a cookie`,
      );
      assert(
        !noncePattern.test(headers["content-security-policy"] ?? ""),
        `a build artifact must not depend on a per-request nonce, and ${file} declares one`,
      );

      contents.set(entry.file, await readOutputFile(outDir, entry.file));
    }

    const second = await probe(outDir);

    assert(
      JSON.stringify(second.entries) === JSON.stringify(first.entries),
      "a repeated static build must produce the same output entries",
    );

    for (const entry of second.entries) {
      assert(
        await readOutputFile(outDir, entry.file) === contents.get(entry.file),
        `a repeated static build must write the same file, and ${JSON.stringify(entry.file)} changed`,
      );
    }
  } finally {
    await rm(outDir, { force: true, recursive: true });
  }
}

// A host that accepts a connection upgrade also has to refuse one. An origin
// it does not own and a request without the upgrade never reach the accepted
// handshake.
async function verifyUpgradeContract(
  probe: (request: Request) => MaybePromise<AdapterUpgradeResult>,
  protocol: "websocket" | "webtransport",
  acceptedStatus: 101 | 200,
) {
  const accepted = await probe(
    upgradeRequest(protocol, adapterContractOrigin),
  );
  const negotiated = lowercaseHeaders(accepted.headers ?? {}).upgrade;

  assert(
    accepted.status === acceptedStatus,
    `an accepted ${protocol} handshake must answer with status ${acceptedStatus}`,
  );
  assert(
    negotiated?.toLowerCase() === protocol,
    `an accepted ${protocol} handshake must confirm the negotiated protocol`,
  );

  const foreign = await probe(upgradeRequest(protocol, foreignOrigin));

  assert(
    foreign.status >= 400 && foreign.status < 500,
    `a ${protocol} handshake from an origin the host does not own must be refused`,
  );

  const plain = await probe(
    new Request(`${adapterContractOrigin}/`, {
      headers: { origin: adapterContractOrigin },
    }),
  );

  assert(
    plain.status !== acceptedStatus,
    `a request without a ${protocol} upgrade must not receive a handshake`,
  );
}

function upgradeRequest(protocol: string, origin: string) {
  return new Request(`${adapterContractOrigin}/`, {
    headers: {
      connection: "Upgrade",
      origin,
      upgrade: protocol,
    },
  });
}

function readCspNonce(response: Response) {
  const csp = response.headers.get("content-security-policy") ?? "";

  return noncePattern.exec(csp)?.[1];
}

async function readOutputFile(outDir: string, file: string) {
  try {
    return await readFile(join(outDir, file), "utf8");
  } catch {
    throw contractError(
      `every output entry must write its file, and ${JSON.stringify(file)} is missing`,
    );
  }
}

function isContainedFile(file: string) {
  return Boolean(file) &&
    !file.startsWith("/") &&
    !file.startsWith("\\") &&
    !file.split(/[\\/]/).includes("..");
}

function lowercaseHeaders(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name.toLowerCase(),
      value,
    ]),
  ) as Record<string, string | undefined>;
}

function tick() {
  return new Promise((resolveTick) => setTimeout(resolveTick, 0));
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
  return new Error(`Adapter contract failed: ${requirement}.`);
}
