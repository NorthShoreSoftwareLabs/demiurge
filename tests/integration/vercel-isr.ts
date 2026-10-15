import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { createMemoryCacheStore, createMemoryRateLimitStore } from "@demiurgejs/core";
import { renderNodePageResponse } from "@demiurgejs/core/node";
import { generateVercelNodeOutput, vercelNode, vercelNodeAdapter } from "@demiurgejs/core/vercel";
import type { ServerBuildPageOptions } from "@demiurgejs/core/vercel";
import { verifyFreshGenerationData } from "./fixtures/vercel-isr-data";
import { verifyProviderModel } from "./fixtures/vercel-isr-model";

// This local harness evaluates candidate rules. It does not emulate Vercel routing or ISR storage.
const scratch = await mkdtemp(join(tmpdir(), "demiurge-isr-proof-"));
const exampleRoot = resolve("examples/vercel-node");
const fixture = resolve("examples/vercel-node/tests/isr-entry.ts");
const server = createServer();
const evidence: ReturnType<typeof record>[] = [];

try {
  const serverDir = join(scratch, "server");
  const configFile = join(scratch, "vite.config.mjs");
  await writeFile(configFile, `export default {
    build: { rollupOptions: {
      external: [/^@demiurgejs\\/core(?:\\/|$)/, /^react(?:\\/|$)/],
      output: { entryFileNames: "server-entry.js" }
    } }
  };`);
  execFileSync(resolve(exampleRoot, "node_modules/.bin/vite"), [
    "build", "--config", configFile, "--ssr", fixture, "--outDir", serverDir,
  ], { cwd: exampleRoot, stdio: "pipe" });
  await symlink(resolve(exampleRoot, "node_modules"), join(scratch, "node_modules"), "dir");
  const artifact = await generateVercelNodeOutput({
    clientDir: resolve(exampleRoot, "dist/client"),
    deployment: vercelNode({ runtime: "nodejs22.x", maxDuration: 60, regions: ["iad1"] }),
    projectRoot: scratch,
    serverDir,
  });
  const functionDir = join(artifact, "functions/demiurge.func");
  const application: typeof import("../../examples/vercel-node/tests/isr-entry") = await import(
    pathToFileURL(join(functionDir, "server/server-entry.js")).href
  );
  const manifest = JSON.parse(await readFile(join(functionDir, "demiurge-manifest.json"), "utf8"));
  const options = {
    adapter: vercelNodeAdapter,
    cacheStore: { namespace: { app: "probe", environment: "local", schemaVersion: 1 }, store: createMemoryCacheStore() },
    clientEntry: manifest.clientEntry,
    rateLimitStore: createMemoryRateLimitStore(),
    renderPage: renderNodePageResponse,
    styles: manifest.styles,
  } satisfies ServerBuildPageOptions;

  // Candidate provider configuration stays in the temporary investigation artifact.
  const bypassToken = randomBytes(32).toString("hex");
  const prerender = {
    expiration: 60,
    group: 481,
    allowQuery: ["edition"],
    passQuery: true,
    bypassToken,
  };
  for (const representation of ["document", "navigation"]) {
    await cp(functionDir, join(artifact, `functions/proof-${representation}.func`), { recursive: true });
    await writeFile(join(artifact, `functions/proof-${representation}.func/index.mjs`), `
import { createNodeRequestListener, renderNodePageResponse } from "@demiurgejs/core/node";
import { createMemoryCacheStore, createMemoryRateLimitStore } from "@demiurgejs/core";
import { vercelNodeAdapter } from "@demiurgejs/core/vercel";
import { createCandidateHandler } from "./server/server-entry.js";
export default createNodeRequestListener({
  allowedHosts: ["127.0.0.1"],
  handler: createCandidateHandler({
    adapter: vercelNodeAdapter,
    cacheStore: { namespace: { app: "proof", environment: "local", schemaVersion: 1 }, store: createMemoryCacheStore() },
    clientEntry: ${JSON.stringify(manifest.clientEntry)},
    styles: ${JSON.stringify(manifest.styles)},
    rateLimitStore: createMemoryRateLimitStore(),
    renderPage: renderNodePageResponse,
  }, ${representation === "navigation"}),
});
`);
    await writeFile(join(artifact, `functions/proof-${representation}.prerender-config.json`),
      JSON.stringify(prerender));
  }
  const candidateRoutes = [
    { src: "^/public/([^/]+)$", methods: ["GET", "HEAD"], has: [{ type: "header", key: "x-demiurge-navigation", value: "data" }], dest: "/proof-navigation" },
    { src: "^/public/([^/]+)$", methods: ["GET", "HEAD"], dest: "/proof-document" },
    { src: "^/.*$", dest: "/demiurge" },
  ];
  await writeFile(join(scratch, "candidate-routing.json"), JSON.stringify({ version: 3, routes: candidateRoutes }));
  assert.notEqual(candidateRoutes[0].dest, candidateRoutes[1].dest);
  await assertNoPublicToken(join(artifact, "static"), bypassToken);

  process.env.ALLOWED_HOSTS = "127.0.0.1";
  const deployed = await import(pathToFileURL(join(functionDir, "index.mjs")).href);
  server.on("request", deployed.default);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;

  const requestHeaders: HeadersInit[] = [
    { accept: "text/html" },
    { accept: "application/json", "x-demiurge-navigation": "data" },
  ];
  for (const headers of requestHeaders) {
    const result = await fetch(`${origin}/public/one`, { headers });
    evidence.push(record("current-adapter", result));
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "private, no-store");
    assert.equal(result.headers.get("vercel-cdn-cache-control"), "no-store");
    await result.text();
  }

  for (const representation of ["document", "navigation"]) {
    const entry = await import(pathToFileURL(join(artifact, `functions/proof-${representation}.func/index.mjs`)).href);
    server.removeAllListeners("request");
    server.on("request", entry.default);
    const result = await fetch(`${origin}/public/one`);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("content-type"), representation === "document" ? "text/html; charset=utf-8" : "application/json");
    assert.match(await result.text(), representation === "document" ? /data-version="1"/ : /"version":1/);
    assert.equal((await fetch(`${origin}/public/one`, { headers: { cookie: "session=private" } })).status, 400);
  }

  const ordinary = application.createHandler(options);
  const generate = async (pathname: string, navigation = false) => {
    const handler = application.createGenerationHandler(options);
    return handler(new Request(`https://generation.invalid${pathname}`, {
      headers: navigation ? { "x-demiurge-navigation": "data" } : { accept: "text/html" },
    }));
  };
  const request = (pathname: string) => new Request(`https://generation.invalid${pathname}`, { headers: { accept: "text/html" } });
  const old = await ordinary(request("/public/one"));
  assert.match(await old.text(), /data-version="1"/);
  application.updateSource(2);
  assert.match(await (await ordinary(request("/public/one"))).text(), /data-version="1"/);
  const before = application.counters().reads;
  const fresh = await generate("/public/one");
  evidence.push(record("isolated-generation-document", fresh));
  assert.equal(fresh.status, 200);
  assert.match(await fresh.text(), /data-version="2"/);
  assert.equal(application.counters().reads, before + 1);
  const navigation = await generate("/public/one", true);
  evidence.push(record("isolated-generation-navigation", navigation));
  assert.equal(navigation.headers.get("x-demiurge-navigation"), "data");
  assert.match(await navigation.text(), /"version":2/);
  application.updateSource(3);
  assert.match(await (await generate("/public/one", true)).text(), /"version":3/);

  // A local hit demonstrates why origin middleware cannot provide a per-request guarantee.
  const publicEntry = await generate("/public/one");
  const stored = await publicEntry.text();
  const middlewareAtGeneration = application.counters().middlewareCalls;
  assert.ok(middlewareAtGeneration > 0);
  const hits = new Map([["document:/public/one", stored]]);
  assert.match(hits.get("document:/public/one") ?? "", /data-version="3"/);
  assert.equal(application.counters().middlewareCalls, middlewareAtGeneration);
  assert.equal(hits.has("navigation:/public/one"), false);

  const safe = application.createCandidateHandler(options, false);
  const privateInputs: RequestInit[] = [
    { headers: { cookie: "session=secret" } },
    { headers: { authorization: "Bearer secret" } },
    { headers: { "x-demiurge-navigation": "document" } },
    { method: "POST" },
  ];
  for (const init of privateInputs) {
    assert.equal((await safe(new Request("https://client.invalid/public/one", init))).status, 400);
  }
  for (const path of ["/public/one?preview=secret", "/public/one?edition=a&edition=b", "/private", "/nonce", "/proof-document"]) {
    assert.equal((await safe(new Request(`https://client.invalid${path}`))).status, 400);
  }
  const hostile = await safe(new Request("https://client.invalid/public/one?edition=public", {
    headers: { "x-private-input": "secret", "x-prerender-revalidate": bypassToken, "x-forwarded-host": "attacker.invalid" },
  }));
  const hostileBody = await hostile.text();
  assert.match(hostileBody, /data-input="public"/);
  assert.ok(!hostileBody.includes("secret") && !hostileBody.includes(bypassToken));
  assert.match(hostileBody, /data-edition="public"/);
  const alternateEdition = await safe(new Request("https://client.invalid/public/one?edition=alternate"));
  assert.match(await alternateEdition.text(), /data-edition="alternate"/);
  const privateResult = await ordinary(new Request("https://generation.invalid/private", { headers: { cookie: "session=secret" } }));
  assert.equal(privateResult.headers.get("cache-control"), "private, no-store");
  assert.ok(privateResult.headers.has("set-cookie"));
  assert.match(await privateResult.text(), /session=secret/);
  const nonce = await ordinary(request("/nonce"));
  assert.match(nonce.headers.get("content-security-policy") ?? "", /nonce-/);
  await nonce.text();
  application.updateSource(4, true);
  assert.equal((await generate("/public/one")).status, 500);
  assert.match(hits.get("document:/public/one") ?? "", /data-version="3"/);
  application.updateSource(4);

  await verifyFreshGenerationData();
  await verifyProviderModel();
  console.log(JSON.stringify({
    scope: "local candidate only; no live provider evidence",
    baseline: "502eea236d3532f707aa1e286eb385cb934e2d95",
    artifact: {
      serverSha256: createHash("sha256").update(await readFile(join(functionDir, "server/server-entry.js"))).digest("hex"),
      runtime: "nodejs22.x", region: "iad1", expiration: prerender.expiration,
      group: prerender.group, allowQuery: prerender.allowQuery, passQuery: prerender.passQuery,
      routing: candidateRoutes,
    },
    evidence,
    sourceCounters: application.counters(),
  }, null, 2));
  console.log("Vercel ISR local investigation passed.");
} finally {
  if (server.listening) await new Promise<void>((done) => server.close(() => done()));
  await rm(scratch, { recursive: true, force: true });
}

function record(probe: string, response: Response) {
  return { probe, method: "GET", pathname: "/public/one", status: response.status, contentType: response.headers.get("content-type"), cacheControl: response.headers.get("cache-control"), csp: response.headers.get("content-security-policy") };
}

async function assertNoPublicToken(directory: string, token: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await assertNoPublicToken(file, token);
    else assert.ok(!(await readFile(file)).includes(Buffer.from(token)));
  }
}
