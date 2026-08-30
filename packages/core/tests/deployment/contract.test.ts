import { describe, expect, it } from "vitest";
import {
  verifyDeploymentContract,
  type DeploymentClaims,
  type DeploymentContractProbes,
  type DeploymentReadinessHost,
  type DeploymentSharedCacheHost,
} from "../../src/deployment/testing";

const noClaims = {
  clientAddress: false,
  readiness: false,
  repeatedHeaders: false,
  requestUrl: false,
  securityHeaders: false,
  sharedCache: false,
  staticAssets: false,
  streaming: false,
} satisfies DeploymentClaims;

const everyClaim = {
  clientAddress: true,
  readiness: true,
  repeatedHeaders: true,
  requestUrl: true,
  securityHeaders: true,
  sharedCache: true,
  staticAssets: true,
  streaming: true,
} satisfies DeploymentClaims;

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

function readinessHost(options: { failShutdown?: boolean } = {}): DeploymentReadinessHost {
  let draining = false;

  return {
    afterShutdown: () =>
      new Response(null, { status: draining ? 503 : 200 }),
    ready: () => new Response(null, { status: draining ? 503 : 200 }),
    async shutdown() {
      if (options.failShutdown) {
        return;
      }

      draining = true;
    },
  };
}

function sharedCacheHost(shared: boolean): DeploymentSharedCacheHost {
  const store = new Map<string, string>();
  let isolated: string | undefined;

  return {
    readFromPeer: (key) =>
      new Response(shared ? (store.get(key) ?? "") : (isolated ?? "")),
    writeFromOrigin: (key, value) => {
      if (shared) {
        store.set(key, value);
      } else {
        isolated = "not visible to a peer";
      }

      return new Response(null, { status: 204 });
    },
  };
}

function compliantProbes(): DeploymentContractProbes {
  let nonce = 0;
  let addressCall = 0;

  return {
    clientAddress: (forwardedFor) => {
      addressCall += 1;
      void addressCall;
      return Response.json({ address: forwardedFor });
    },
    readiness: () => readinessHost(),
    repeatedHeaders: () => {
      const headers = new Headers();
      headers.append("set-cookie", "session=one; Path=/");
      headers.append("set-cookie", "csrf=two; Path=/");
      return new Response(null, { headers });
    },
    requestUrl: (pathname, search) =>
      Response.json({ pathname, search }),
    securityHeaders: () =>
      new Response(`<script nonce="nonce-${++nonce}"></script>`, {
        headers: {
          "content-security-policy": `script-src 'nonce-nonce-${nonce}'`,
          "x-content-type-options": "nosniff",
        },
      }),
    sharedCache: () => sharedCacheHost(true),
    staticAssets: () =>
      new Response("body of /assets/app-abcdef12.js", {
        headers: {
          "cache-control": "public, max-age=31536000, immutable",
        },
      }),
    streaming: () => streamingResponse(["one ", "two ", "three"]),
  };
}

describe("verifyDeploymentContract", () => {
  it("passes a deployment that proves every probe it claims", async () => {
    await expect(
      verifyDeploymentContract(everyClaim, compliantProbes()),
    ).resolves.toBeUndefined();
  });

  it("passes a deployment that claims nothing and probes nothing", async () => {
    await expect(verifyDeploymentContract(noClaims, {})).resolves.toBeUndefined();
  });

  it("fails when a capability is declared true without a probe", async () => {
    await expect(
      verifyDeploymentContract({ ...noClaims, streaming: true }, {}),
    ).rejects.toThrow('capability "streaming" is declared true');
  });

  it("fails when a probe is supplied without a matching claim", async () => {
    await expect(
      verifyDeploymentContract(noClaims, { streaming: compliantProbes().streaming }),
    ).rejects.toThrow('capability "streaming" has a probe');
  });

  it("fails a false request-url claim from a provider that rewrites the path", async () => {
    const probes = compliantProbes();
    probes.requestUrl = () => Response.json({ pathname: "/internal-rewrite", search: "" });

    await expect(
      verifyDeploymentContract(everyClaim, probes),
    ).rejects.toThrow("report the client's request pathname");
  });

  it("fails a false client-address claim from a provider that never translates it", async () => {
    const probes = compliantProbes();
    probes.clientAddress = () => Response.json({ address: "10.0.0.1" });

    await expect(
      verifyDeploymentContract(everyClaim, probes),
    ).rejects.toThrow("translate the forwarded client address");
  });

  it("fails a false streaming claim from a provider that buffers the body", async () => {
    const probes = compliantProbes();
    probes.streaming = () => new Response("buffered whole");

    await expect(
      verifyDeploymentContract(everyClaim, probes),
    ).rejects.toThrow("more than one chunk");
  });

  it("fails a false repeated-headers claim from a provider that merges Set-Cookie", async () => {
    const probes = compliantProbes();
    probes.repeatedHeaders = () =>
      new Response(null, {
        headers: { "set-cookie": "session=one; Path=/" },
      });

    await expect(
      verifyDeploymentContract(everyClaim, probes),
    ).rejects.toThrow("forward every Set-Cookie header");
  });

  it("fails a false static-assets claim missing an immutable cache header", async () => {
    const probes = compliantProbes();
    probes.staticAssets = () => new Response("body of /assets/app-abcdef12.js");

    await expect(
      verifyDeploymentContract(everyClaim, probes),
    ).rejects.toThrow("immutable, long-lived cache-control");
  });

  it("fails a false security-headers claim reusing the same nonce", async () => {
    const probes = compliantProbes();
    probes.securityHeaders = () =>
      new Response('<script nonce="fixed"></script>', {
        headers: {
          "content-security-policy": "script-src 'nonce-fixed'",
          "x-content-type-options": "nosniff",
        },
      });

    await expect(
      verifyDeploymentContract(everyClaim, probes),
    ).rejects.toThrow("freshly generated nonce");
  });

  it("fails a false shared-cache claim backed by per-instance memory", async () => {
    const probes = compliantProbes();
    probes.sharedCache = () => sharedCacheHost(false);

    await expect(
      verifyDeploymentContract(everyClaim, probes),
    ).rejects.toThrow("visible from another instance");
  });

  it("fails a false readiness claim that never drains", async () => {
    const probes = compliantProbes();
    probes.readiness = () => ({
      afterShutdown: () => new Response(null, { status: 200 }),
      ready: () => new Response(null, { status: 200 }),
      shutdown: async () => {},
    });

    await expect(
      verifyDeploymentContract(everyClaim, probes),
    ).rejects.toThrow("stop reporting ready once shutdown starts");
  });
});
