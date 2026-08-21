import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createMemoryCacheStore,
  defineAdapter,
  type Adapter,
  type AdapterCapabilityMap,
  type CacheStore,
} from "@demiurgejs/core";
import {
  adapterContractOrigin,
  verifyAdapterContract,
  type AdapterContractProbes,
  type AdapterStaticOutputEntry,
  type AdapterUpgradeResult,
} from "../../src/adapter/testing";

const everyCapability = {
  backgroundLifetime: true,
  crossOriginIsolationHeaders: true,
  nonceInjection: true,
  sharedCache: true,
  staticOutput: true,
  streaming: true,
  webSocket: true,
  webTransport: true,
} satisfies AdapterCapabilityMap;

const compliantAdapter = defineAdapter({
  name: "compliant",
  capabilities: everyCapability,
});

function streamingResponse(chunks: readonly string[]) {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }

        controller.close();
      },
    }),
  );
}

function nonceResponse(nonce: string, cacheControl = "private, no-store") {
  return new Response(`<script nonce="${nonce}"></script>`, {
    headers: {
      "cache-control": cacheControl,
      "content-security-policy": `script-src 'nonce-${nonce}'`,
    },
  });
}

function isolatedResponse(headers: Record<string, string> = {}) {
  return new Response("isolated", {
    headers: {
      "cross-origin-embedder-policy": "require-corp",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-resource-policy": "same-origin",
      ...headers,
    },
  });
}

function backgroundHost(options: { failShutdown?: boolean } = {}) {
  const tasks = new Set<Promise<unknown>>();

  return {
    async shutdown() {
      if (options.failShutdown) {
        await Promise.all(tasks);
        return;
      }

      await Promise.allSettled(tasks);
    },
    waitUntil(promise: Promise<unknown>) {
      tasks.add(promise);
    },
  };
}

function upgradeHandler(
  accepted: number,
  protocol: string,
): (request: Request) => AdapterUpgradeResult {
  return (request) => {
    if (request.headers.get("upgrade")?.toLowerCase() !== protocol) {
      return { status: 426 };
    }

    if (request.headers.get("origin") !== adapterContractOrigin) {
      return { status: 403 };
    }

    return { headers: { upgrade: protocol }, status: accepted };
  };
}

function staticOutputProbe(
  entries: readonly AdapterStaticOutputEntry[],
  bodyOf: (entry: AdapterStaticOutputEntry, run: number) => string =
    (entry) => `body of ${entry.pathname}`,
) {
  let run = 0;

  return async (outDir: string) => {
    run += 1;

    for (const entry of entries) {
      const file = join(outDir, entry.file);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, bodyOf(entry, run));
    }

    return { entries };
  };
}

const homeEntry = {
  file: "index.html",
  headers: { "content-type": "text/html; charset=utf-8" },
  pathname: "/",
} satisfies AdapterStaticOutputEntry;

function compliantProbes(): AdapterContractProbes {
  let nonce = 0;

  return {
    backgroundLifetime: () => backgroundHost(),
    crossOriginIsolationHeaders: () => isolatedResponse(),
    nonceInjection: () => nonceResponse(`nonce-value-${++nonce}`),
    sharedCache: createMemoryCacheStore,
    staticOutput: staticOutputProbe([homeEntry]),
    streaming: () => streamingResponse(["<html>", "</html>"]),
    webSocket: upgradeHandler(101, "websocket"),
    webTransport: upgradeHandler(200, "webtransport"),
  };
}

function partialAdapter(capabilities: Partial<AdapterCapabilityMap>) {
  return defineAdapter({ name: "partial", capabilities });
}

async function expectViolation(
  adapter: Adapter,
  probes: AdapterContractProbes,
  requirement: string,
) {
  await expect(verifyAdapterContract(adapter, probes)).rejects.toThrow(
    requirement,
  );
}

describe("adapter contract suite", () => {
  it("passes an adapter that proves every capability it declares", async () => {
    await expect(
      verifyAdapterContract(compliantAdapter, compliantProbes()),
    ).resolves.toBeUndefined();
  });

  it("requires an adapter name", async () => {
    await expectViolation(
      { capabilities: everyCapability, name: "" },
      compliantProbes(),
      "an adapter must carry a name",
    );
  });

  it("requires every capability to be declared as a boolean", async () => {
    await expectViolation(
      {
        // SAFETY: undefined as never injects an invalid capability for the contract test.
        capabilities: {
          ...everyCapability,
          streaming: undefined as never,
        },
        name: "untyped",
      },
      compliantProbes(),
      'an adapter must declare capability "streaming" as a boolean',
    );
  });

  it("requires a probe for every declared capability", async () => {
    await expectViolation(
      partialAdapter({ staticOutput: true }),
      {},
      'capability "staticOutput" is declared true and needs a probe',
    );
  });

  it("refuses a probe for a capability the adapter does not declare", async () => {
    await expectViolation(
      partialAdapter({}),
      { streaming: () => streamingResponse(["a", "b"]) },
      'capability "streaming" has a probe but the adapter declares it false',
    );
  });

  it("passes an adapter that declares no capability", async () => {
    await expect(
      verifyAdapterContract(partialAdapter({}), {}),
    ).resolves.toBeUndefined();
  });

  it("catches a streaming response without a body stream", async () => {
    await expectViolation(
      partialAdapter({ streaming: true }),
      { streaming: () => new Response(null, { status: 204 }) },
      "must expose a readable body stream",
    );
  });

  it("catches a streaming response with an empty body", async () => {
    await expectViolation(
      partialAdapter({ streaming: true }),
      { streaming: () => streamingResponse([]) },
      "must deliver a body",
    );
  });

  it("catches a buffered response that claims to stream", async () => {
    await expectViolation(
      partialAdapter({ streaming: true }),
      { streaming: () => new Response("rendered all at once") },
      "must deliver its body in more than one chunk",
    );
  });

  it("catches a streaming body that refuses cancellation", async () => {
    await expectViolation(
      partialAdapter({ streaming: true }),
      {
        streaming: () =>
          new Response(
            new ReadableStream<Uint8Array>({
              cancel() {
                throw new Error("cancel refused");
              },
              start(controller) {
                controller.enqueue(new TextEncoder().encode("<html>"));
                controller.enqueue(new TextEncoder().encode("</html>"));
                controller.close();
              },
            }),
          ),
      },
      "must accept cancellation, and it failed with cancel refused",
    );
  });

  it("catches a document with no nonce source in its policy", async () => {
    await expectViolation(
      partialAdapter({ nonceInjection: true }),
      { nonceInjection: () => new Response("<html></html>") },
      "must declare a content-security-policy nonce source",
    );
  });

  it("catches a repeated nonce", async () => {
    await expectViolation(
      partialAdapter({ nonceInjection: true }),
      { nonceInjection: () => nonceResponse("fixed-nonce") },
      "must carry a freshly generated nonce",
    );
  });

  it("catches a document that omits the nonce its header declares", async () => {
    let nonce = 0;

    await expectViolation(
      partialAdapter({ nonceInjection: true }),
      {
        nonceInjection: () =>
          new Response("<script></script>", {
            headers: {
              "cache-control": "private, no-store",
              "content-security-policy": `script-src 'nonce-value-${++nonce}'`,
            },
          }),
      },
      "must carry the nonce its header declares",
    );
  });

  it("catches a nonce-backed document offered to a shared cache", async () => {
    let nonce = 0;

    await expectViolation(
      partialAdapter({ nonceInjection: true }),
      {
        nonceInjection: () =>
          nonceResponse(`nonce-value-${++nonce}`, "public, max-age=60"),
      },
      "must not be a shared cache representation",
    );
  });

  it("catches a missing opener policy", async () => {
    await expectViolation(
      partialAdapter({ crossOriginIsolationHeaders: true }),
      {
        crossOriginIsolationHeaders: () =>
          isolatedResponse({ "cross-origin-opener-policy": "unsafe-none" }),
      },
      "must carry cross-origin-opener-policy same-origin",
    );
  });

  it("catches a missing embedder policy", async () => {
    await expectViolation(
      partialAdapter({ crossOriginIsolationHeaders: true }),
      {
        crossOriginIsolationHeaders: () =>
          isolatedResponse({ "cross-origin-embedder-policy": "unsafe-none" }),
      },
      "require-corp or credentialless",
    );
  });

  it("catches a missing resource policy", async () => {
    await expectViolation(
      partialAdapter({ crossOriginIsolationHeaders: true }),
      {
        crossOriginIsolationHeaders: () =>
          new Response("isolated", {
            headers: {
              "cross-origin-embedder-policy": "credentialless",
              "cross-origin-opener-policy": "same-origin",
            },
          }),
      },
      "must carry a cross-origin-resource-policy",
    );
  });

  it("catches a shutdown that abandons background work", async () => {
    await expectViolation(
      partialAdapter({ backgroundLifetime: true }),
      { backgroundLifetime: () => ({ shutdown: async () => {}, waitUntil: () => {} }) },
      "must not complete while background work is pending",
    );
  });

  it("catches a shutdown that fails with its background work", async () => {
    await expectViolation(
      partialAdapter({ backgroundLifetime: true }),
      { backgroundLifetime: () => backgroundHost({ failShutdown: true }) },
      "must not fail shutdown, and it failed with Adapter contract background failure",
    );
  });

  it("verifies a shared cache without stale refresh coordination", async () => {
    await expect(
      verifyAdapterContract(partialAdapter({ sharedCache: true }), {
        sharedCache: () => withoutRefreshLeases(createMemoryCacheStore()),
      }),
    ).resolves.toBeUndefined();
  });

  it("reports a shared cache that breaks the cache store contract", async () => {
    await expectViolation(
      partialAdapter({ sharedCache: true }),
      {
        sharedCache: () => ({
          delete: () => false,
          get: () => undefined,
          invalidateTags: () => 0,
          set: () => undefined,
        }),
      },
      "Cache store contract failed",
    );
  });

  it("catches a static build that produces no entry", async () => {
    await expectViolation(
      partialAdapter({ staticOutput: true }),
      { staticOutput: staticOutputProbe([]) },
      "must produce at least one output entry",
    );
  });

  it("catches an output file that escapes the output directory", async () => {
    await expectViolation(
      partialAdapter({ staticOutput: true }),
      {
        staticOutput: () => ({
          entries: [{ ...homeEntry, file: "../escaped.html" }],
        }),
      },
      "must stay inside the output directory",
    );
  });

  it("catches a repeated output file", async () => {
    await expectViolation(
      partialAdapter({ staticOutput: true }),
      {
        staticOutput: staticOutputProbe([
          homeEntry,
          { ...homeEntry, pathname: "/duplicate" },
        ]),
      },
      "must own one file",
    );
  });

  it("catches a repeated output pathname", async () => {
    await expectViolation(
      partialAdapter({ staticOutput: true }),
      {
        staticOutput: staticOutputProbe([
          homeEntry,
          { ...homeEntry, file: "duplicate/index.html" },
        ]),
      },
      "must own one pathname",
    );
  });

  it("catches a build artifact that sets a cookie", async () => {
    await expectViolation(
      partialAdapter({ staticOutput: true }),
      {
        staticOutput: staticOutputProbe([
          { ...homeEntry, headers: { "Set-Cookie": "session=1" } },
        ]),
      },
      "must not carry per-request state",
    );
  });

  it("catches a build artifact that depends on a nonce", async () => {
    await expectViolation(
      partialAdapter({ staticOutput: true }),
      {
        staticOutput: staticOutputProbe([
          {
            ...homeEntry,
            headers: { "content-security-policy": "script-src 'nonce-abc'" },
          },
        ]),
      },
      "must not depend on a per-request nonce",
    );
  });

  it("catches an entry with no file on disk", async () => {
    await expectViolation(
      partialAdapter({ staticOutput: true }),
      { staticOutput: () => ({ entries: [homeEntry] }) },
      "must write its file",
    );
  });

  it("catches a static build that changes its entries between runs", async () => {
    let run = 0;

    await expectViolation(
      partialAdapter({ staticOutput: true }),
      {
        staticOutput: async (outDir) => {
          run += 1;
          const entries = run === 1
            ? [homeEntry]
            : [{ ...homeEntry, pathname: "/moved" }];
          await staticOutputProbe(entries)(outDir);
          return { entries };
        },
      },
      "must produce the same output entries",
    );
  });

  it("catches a static build that rewrites a file between runs", async () => {
    await expectViolation(
      partialAdapter({ staticOutput: true }),
      {
        staticOutput: staticOutputProbe(
          [homeEntry],
          (entry, run) => `body of ${entry.pathname} for run ${run}`,
        ),
      },
      "must write the same file",
    );
  });

  it("catches a refused upgrade the adapter claims to accept", async () => {
    await expectViolation(
      partialAdapter({ webSocket: true }),
      { webSocket: () => ({ status: 403 }) },
      "must answer with status 101",
    );
  });

  it("catches a handshake that does not confirm the protocol", async () => {
    await expectViolation(
      partialAdapter({ webSocket: true }),
      { webSocket: () => ({ status: 101 }) },
      "must confirm the negotiated protocol",
    );
  });

  it("catches an upgrade accepted from a foreign origin", async () => {
    await expectViolation(
      partialAdapter({ webSocket: true }),
      {
        webSocket: (request) =>
          request.headers.get("upgrade") === "websocket"
            ? { headers: { upgrade: "websocket" }, status: 101 }
            : { status: 426 },
      },
      "from an origin the host does not own must be refused",
    );
  });

  it("catches a handshake given to a request without an upgrade", async () => {
    await expectViolation(
      partialAdapter({ webSocket: true }),
      {
        webSocket: (request) =>
          request.headers.get("origin") === adapterContractOrigin
            ? { headers: { upgrade: "websocket" }, status: 101 }
            : { status: 403 },
      },
      "without a websocket upgrade must not receive a handshake",
    );
  });

  it("verifies a WebTransport session handshake", async () => {
    await expect(
      verifyAdapterContract(partialAdapter({ webTransport: true }), {
        webTransport: upgradeHandler(200, "webtransport"),
      }),
    ).resolves.toBeUndefined();
  });
});

function withoutRefreshLeases(store: CacheStore): CacheStore {
  return {
    delete: (key) => store.delete(key),
    get: (key) => store.get(key),
    invalidateTags: (tags) => store.invalidateTags(tags),
    set: (key, entry) => store.set(key, entry),
  };
}
