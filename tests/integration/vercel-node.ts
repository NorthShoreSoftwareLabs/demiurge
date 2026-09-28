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
const staticAboutFile = resolve(staticDirectory, "about/index.html");
const module = await import(pathToFileURL(functionEntry).href);

if (typeof module.default !== "function") {
  throw new Error("The Vercel function entry does not export a listener.");
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const isStaticAboutRequest =
    (request.method === "GET" || request.method === "HEAD") &&
    request.headers["x-demiurge-navigation"] !== "data" &&
    (url.pathname === "/about" || url.pathname === "/about/");
  if (isStaticAboutRequest) {
    void readFile(staticAboutFile).then((html) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.setHeader("x-vercel-local-route", "filesystem");
      response.end(request.method === "HEAD" ? undefined : html);
    }, (error: unknown) => {
      response.destroy(error instanceof Error ? error : new Error(String(error)));
    });
    return;
  }
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
  await assertMissing(
    resolve(staticDirectory, "index.html"),
    "The Vercel filesystem captured the runtime root route.",
  );
  const staticAbout = await fetch(`${origin}/about`, {
    headers: { accept: "text/html" },
  }).catch((error: unknown) => {
    throw new Error("The prerendered route request failed.", { cause: error });
  });
  const staticAboutHtml = await staticAbout.text();
  if (
    staticAbout.status !== 200 ||
    staticAbout.headers.get("x-vercel-local-route") !== "filesystem" ||
    !staticAboutHtml.includes("Prerendered application route")
  ) {
    throw new Error("The Vercel filesystem did not own the prerendered route.");
  }

  const staticNavigation = await fetch(`${origin}/about`, {
    headers: {
      accept: "application/json",
      "x-demiurge-navigation": "data",
    },
  }).catch((error: unknown) => {
    throw new Error("The prerendered navigation request failed.", { cause: error });
  });
  if (
    staticNavigation.status !== 200 ||
    staticNavigation.headers.get("x-demiurge-navigation") !== "data" ||
    staticNavigation.headers.has("x-vercel-local-route")
  ) {
    throw new Error("The Vercel function did not own navigation for a prerendered route.");
  }

  const outputConfig = JSON.parse(await readFile(
    resolve(artifactRoot, "config.json"),
    "utf8",
  ));
  const outputRoutes = Array.isArray(outputConfig.routes) ? outputConfig.routes : [];
  const filesystemIndex = outputRoutes.findIndex(
    (route: { handle?: string }) => route.handle === "filesystem",
  );
  const navigationIndex = outputRoutes.findIndex(
    (route: { dest?: string; has?: Array<{ key?: string; value?: string }> }) =>
      route.dest === "/demiurge" && route.has?.some((condition) =>
        condition.key === "x-demiurge-navigation" && condition.value === "data"
      ),
  );
  const staticAboutIndex = outputRoutes.findIndex(
    (route: { dest?: string; methods?: string[]; src?: string }) =>
      route.dest === "/about/index.html" &&
      route.methods?.join(",") === "GET,HEAD" &&
      route.src === "^/about/?$",
  );
  const fallbackIndex = outputRoutes.findIndex(
    (route: { dest?: string; methods?: string[]; src?: string }) =>
      route.dest === "/demiurge" &&
      route.src === "^/.*$" &&
      route.methods === undefined,
  );
  if (
    outputRoutes[0]?.dest !== "/demiurge" ||
    outputRoutes[0]?.methods?.join(",") !==
      "POST,PUT,PATCH,DELETE,OPTIONS" ||
    navigationIndex < 0 ||
    staticAboutIndex < 0 ||
    filesystemIndex < 0 ||
    fallbackIndex < 0 ||
    navigationIndex > filesystemIndex ||
    staticAboutIndex > filesystemIndex ||
    filesystemIndex > fallbackIndex
  ) {
    throw new Error("The Vercel artifact does not use the required route order.");
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

async function assertMissing(file: string, message: string) {
  try {
    await access(file);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
  throw new Error(message);
}
