import { createServer } from "node:http";
import { access, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  verifyDeploymentContract,
  type DeploymentClaims,
} from "@demiurgejs/core/deployment/testing";

process.env.ALLOWED_HOSTS = "127.0.0.1";
delete process.env.CONTACT_EMAIL_FROM;
delete process.env.CONTACT_EMAIL_TO;
delete process.env.RESEND_API_KEY;

const artifactRoot = await mkdtemp(join(tmpdir(), "demiurge-vercel-artifact-"));
await cp("examples/vercel-node/.vercel/output", artifactRoot, { recursive: true });
const functionEntry = resolve(artifactRoot, "functions/demiurge.func/index.mjs");
const staticDirectory = resolve(artifactRoot, "static");
const module = await import(pathToFileURL(functionEntry).href);

if (typeof module.default !== "function") {
  throw new Error("The Vercel function entry does not export a listener.");
}

const server = createServer((request, response) => {
  void module.default(request, response);
});

await new Promise<void>((resolveListen) => {
  server.listen(0, "127.0.0.1", resolveListen);
});

try {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("The Vercel function probe has no loopback address.");
  }
  const origin = `http://127.0.0.1:${address.port}`;
  const page = await fetch(origin, { headers: { accept: "text/html" } });
  const html = await page.text();

  if (
    page.status !== 200 ||
    page.headers.get("cache-control") !== "private, no-store" ||
    !page.headers.get("content-security-policy") ||
    !html.includes("Demiurge runs on Vercel")
  ) {
    throw new Error("The generated Vercel function did not return its secure page response.");
  }

  const asset = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
  if (!asset) {
    throw new Error("The generated Vercel page does not reference a client asset.");
  }
  await access(resolve(staticDirectory, `.${asset}`));
  const outputConfig = JSON.parse(await readFile(
    resolve(artifactRoot, "config.json"),
    "utf8",
  ));
  if (
    outputConfig.routes?.[0]?.handle !== "filesystem" ||
    outputConfig.routes?.[1]?.dest !== "/demiurge"
  ) {
    throw new Error("The Vercel artifact does not route static files before the function.");
  }

  const claims = {
    clientAddress: true,
    readiness: false,
    repeatedHeaders: true,
    requestUrl: true,
    securityHeaders: true,
    sharedCache: false,
    staticAssets: false,
    streaming: true,
  } satisfies DeploymentClaims;
  await verifyDeploymentContract(claims, {
    clientAddress: (forwardedFor) =>
      fetch(`${origin}/deployment-contract/client-address`, {
        headers: { "x-vercel-forwarded-for": forwardedFor },
      }),
    repeatedHeaders: () => fetch(`${origin}/deployment-contract/repeated-headers`),
    requestUrl: (pathname, search) => fetch(`${origin}${pathname}${search}`),
    securityHeaders: () => fetch(origin, { headers: { accept: "text/html" } }),
    streaming: () => fetch(`${origin}/deployment-contract/streaming`),
  });

  const contact = await fetch(`${origin}/api/contact`, {
    body: JSON.stringify({
      email: "test@example.test",
      message: "This request does not send an email.",
      name: "Test User",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (contact.status !== 502) {
    throw new Error(`The contact endpoint returned ${contact.status} without email credentials.`);
  }

  console.log("Vercel Node function artifact probe passed.");
} finally {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  await rm(artifactRoot, { force: true, recursive: true });
}
