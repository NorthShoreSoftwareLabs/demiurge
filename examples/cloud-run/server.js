/* global console, process, Response, ReadableStream, TextEncoder, URL, Headers, setTimeout */

import { createMemoryCacheStore, getRequestClientAddress } from "@demiurgejs/core";
import { serveNodeBuild } from "@demiurgejs/core/node";
import { createHandler } from "./dist/server/server-entry.js";

// These endpoints exist only for the deployment conformance kit
// (`@demiurgejs/core/deployment/testing`). They prove this container's
// production path carries the request URL, the client address, a streamed
// body, repeated headers, and static asset caching intact. See
// `tests/integration/cloud-run.ts`.
const deploymentContractPrefix = "/.well-known/deployment-contract/";

function handleDeploymentContractRequest(request, url) {
  const probe = url.pathname.slice(deploymentContractPrefix.length);

  if (probe === "client-address") {
    return Response.json({
      address: getRequestClientAddress(request) ?? "unknown",
    });
  }

  if (probe === "streaming") {
    const encoder = new TextEncoder();

    return new Response(
      new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode("chunk one "));
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
          controller.enqueue(encoder.encode("chunk two "));
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
          controller.enqueue(encoder.encode("chunk three"));
          controller.close();
        },
      }),
    );
  }

  if (probe === "repeated-headers") {
    const headers = new Headers();
    headers.append("set-cookie", "deployment-contract-a=one; Path=/");
    headers.append("set-cookie", "deployment-contract-b=two; Path=/");
    return new Response(null, { headers });
  }

  return new Response("Unknown deployment contract probe.", { status: 404 });
}

const reportBackgroundError = (error) => {
  console.error("Demiurge Cloud Run background task failed.", error);
};

await serveNodeBuild({
  allowedHosts: (process.env.ALLOWED_HOSTS ?? "localhost")
    .split(",")
    .map((value) => value.trim()),
  base: import.meta.url,
  createHandler({ page, waitUntil }) {
    const applicationHandler = createHandler({
      ...page,
      cacheStore: {
        namespace: {
          app: "demiurge-cloud-run-example",
          environment: process.env.NODE_ENV ?? "development",
          schemaVersion: 1,
        },
        onBackgroundError: reportBackgroundError,
        store: createMemoryCacheStore(),
        waitUntil,
      },
    });

    return (request) => {
      const url = new URL(request.url);

      // The request-url probe needs an arbitrary client-chosen path, not one
      // this server already routes. It is recognized by a header instead of a
      // fixed path prefix.
      if (request.headers.get("x-deployment-contract-probe") === "request-url") {
        return Response.json({ pathname: url.pathname, search: url.search });
      }

      if (url.pathname.startsWith(deploymentContractPrefix)) {
        return handleDeploymentContractRequest(request, url);
      }

      return applicationHandler(request);
    };
  },
  // Cloud Run injects PORT and expects the container to bind 0.0.0.0. Binding a
  // loopback address would leave the platform unable to reach the process.
  host: process.env.HOST ?? "0.0.0.0",
  name: "Demiurge Cloud Run server",
  port: 8080,
  shutdown: {
    gracePeriod: 30_000,
    onBackgroundError: reportBackgroundError,
    onStateChange(state) {
      console.log(`Demiurge Cloud Run server state: ${state}`);
    },
    signals: ["SIGINT", "SIGTERM"],
  },
  // Cloud Run's front end is the one hop between the client and this
  // container. Trusting a single proxy hop resolves the real client
  // address from `X-Forwarded-For` instead of the front end's own address.
  trustProxy: { hops: 1 },
});
