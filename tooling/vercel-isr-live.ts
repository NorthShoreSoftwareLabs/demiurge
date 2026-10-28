import assert from "node:assert/strict";
import { assessCompletion, assessIsolated } from "./vercel-isr-live-assessment";
import { verifyRollback } from "./vercel-isr-live-rollback";
import { verifyBrowser } from "./vercel-isr-live-browser";
import { nonceMatchesBody } from "./vercel-isr-live-security";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateVercelNodeOutput, vercelNode } from "@demiurgejs/core/vercel";

const isolated = process.argv.includes("--isolated");
const assessmentIndex = process.argv.indexOf("--assess");
if (assessmentIndex >= 0) {
  const record = JSON.parse(await readFile(process.argv[assessmentIndex + 1], "utf8"));
  assert.ok(Array.isArray(record.results));
  const failures = record.candidate === "complete-private-vercel-proof" ? assessCompletion(record.results) : record.candidate === "representation-query-and-edge-guard" ? assessIsolated(record.results) : assess(record.results);
  console.log(JSON.stringify({ passed: failures.length === 0, failures }, null, 2));
  process.exit(failures.length ? 1 : 0);
}

if (!process.argv.includes("--run")) {
  throw new Error("Pass --run to deploy live probes to the dedicated demiurge-verification project.");
}

const scratch = await mkdtemp(join(tmpdir(), "demiurge-isr-live-"));
const sourceBaseline = (await command("git", ["rev-parse", "HEAD"], process.cwd())).trim();
const rollbackAlias = `demiurge-isr-rollback-${Date.now()}.vercel.app`;
const sourceFiles = ["tooling/vercel-isr-live-rollback-assessment.ts", "tooling/vercel-isr-live-rollback.ts", "tooling/vercel-isr-live-browser.ts", "examples/vercel-node/tests/isr-live-client.ts", "examples/vercel-node/tests/isr-live-view.ts", "tooling/vercel-isr-live.ts", "tooling/vercel-isr-live-security.ts", "tooling/vercel-isr-live-assessment.ts", "tooling/vercel-isr-live-guard.ts", "examples/vercel-node/tests/isr-live-entry.ts"];
const sourceStatus = await command("git", ["status", "--porcelain", "--", ...sourceFiles], process.cwd());
const sourceCommit = sourceStatus.trim() === "" ? sourceBaseline : null;
const workingTreeSources = {
  rollbackAssessment: createHash("sha256").update(await readFile("tooling/vercel-isr-live-rollback-assessment.ts")).digest("hex"),
  rollback: createHash("sha256").update(await readFile("tooling/vercel-isr-live-rollback.ts")).digest("hex"),
  browser: createHash("sha256").update(await readFile("tooling/vercel-isr-live-browser.ts")).digest("hex"),
  client: createHash("sha256").update(await readFile("examples/vercel-node/tests/isr-live-client.ts")).digest("hex"),
  view: createHash("sha256").update(await readFile("examples/vercel-node/tests/isr-live-view.ts")).digest("hex"),
  security: createHash("sha256").update(await readFile("tooling/vercel-isr-live-security.ts")).digest("hex"),
  assessment: createHash("sha256").update(await readFile("tooling/vercel-isr-live-assessment.ts")).digest("hex"),
  fixture: createHash("sha256").update(await readFile("examples/vercel-node/tests/isr-live-entry.ts")).digest("hex"),
  runner: createHash("sha256").update(await readFile("tooling/vercel-isr-live.ts")).digest("hex"),
  ...(isolated ? { guard: createHash("sha256").update(await readFile("tooling/vercel-isr-live-guard.ts")).digest("hex") } : {}),
};
const evidenceFile = join(tmpdir(), `demiurge-isr-live-${Date.now()}.json`);
const token = randomBytes(32).toString("hex");
const sourceToken = randomBytes(32).toString("hex");
const state = { version: 1, fail: false, delayMs: 0 };
let sourceReads = 0;
const results: Array<Record<string, unknown>> = [];
const source = createServer((request, response) => {
  if (request.url !== "/state" || request.method !== "GET" || request.headers.authorization !== `Bearer ${sourceToken}`) {
    response.writeHead(404).end();
    return;
  }
  sourceReads++;
  sourceEvents.push({ contribution: String(request.headers["x-proof-contribution"] ?? "health"), version: state.version, fail: state.fail, at: new Date().toISOString() });
  response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(state));
});
let tunnel: ReturnType<typeof spawn> | undefined;
let deployment = "";
let artifactHash = "";
let fullArtifactHash = "";
let routing: unknown = null;
let requestSequence = 0;
const sourceEvents: Array<{contribution: string; version: number; fail: boolean; at: string}> = [];

try {
  const project = JSON.parse(await readFile("examples/vercel-node/.vercel/project.json", "utf8"));
  assert.equal(project.projectName, "demiurge-verification");
  assert.equal(project.projectId, "prj_T5AAGBC2CMAKeh5FkfDlVg96PARF");
  await mkdir(join(scratch, ".vercel"));
  await writeFile(join(scratch, ".vercel/project.json"), JSON.stringify(project));
  await new Promise<void>((done, reject) => {
    source.once("error", reject);
    source.listen(0, "127.0.0.1", done);
  });
  const address = source.address();
  assert.ok(address && typeof address !== "string");
  tunnel = spawn("ngrok", ["http", String(address.port), "--log", "stdout", "--log-format", "json", "--inspect=false"], { stdio: ["ignore", "pipe", "pipe"] });
  const sourceOrigin = await new Promise<string>((done, reject) => {
    const timeout = setTimeout(() => reject(new Error("The source tunnel did not start.")), 30_000);
    const receive = (chunk: Buffer) => {
      const message = String(chunk);
      const match = /"url":"(https:\/\/[^"]+)"/.exec(message);
      if (match) { clearTimeout(timeout); done(match[1]); }
      if (message.includes('"lvl":"eror"') || message.includes("ERR_NGROK")) {
        clearTimeout(timeout);
        reject(new Error(`The source tunnel failed: ${message.replace(/authtoken[^,\n]*/gi, "credential redacted")}`));
      }
    };
    tunnel!.stdout!.on("data", receive);
    tunnel!.stderr!.on("data", receive);
    tunnel!.once("error", reject);
    tunnel!.once("exit", (code) => reject(new Error(`The source tunnel exited with code ${code}.`)));
  });
  console.log("Shared synthetic source tunnel started.");
  let healthy = false;
  for (let attempt = 0; attempt < 20 && !healthy; attempt++) {
    const health = await fetch(`${sourceOrigin}/state`, { headers: { authorization: `Bearer ${sourceToken}`, "ngrok-skip-browser-warning": "1" } });
    healthy = health.status === 200 && (await health.json()).version === 1;
    if (!healthy) await new Promise((done) => setTimeout(done, 500));
  }
  assert.ok(healthy, "The shared source did not become reachable.");

  const example = resolve("examples/vercel-node");
  const serverDir = join(scratch, "server");
  const config = join(scratch, "vite.config.mjs");
  await writeFile(config, `export default { build: { rollupOptions: {
    external: [/^@demiurgejs\\/core(?:\\/|$)/, /^react(?:\\/|$)/], output: { entryFileNames: "server-entry.js" }
  } } };`);
  await command(resolve(example, "node_modules/.bin/vite"), ["build", "--config", config, "--ssr", resolve(example, "tests/isr-live-entry.ts"), "--outDir", serverDir], example);
  await symlink(join(example, "node_modules"), join(scratch, "node_modules"), "dir");
  const output = await generateVercelNodeOutput({
    projectRoot: scratch, clientDir: join(example, "dist/client"), serverDir,
    deployment: vercelNode({ runtime: "nodejs22.x", maxDuration: 60, regions: ["iad1"] }),
  });
  const clientConfig = join(scratch, "client.vite.config.mjs");
  await writeFile(clientConfig, `export default { build: { target: "es2022", minify: false, rollupOptions: { input: ${JSON.stringify(resolve(example, "tests/isr-live-client.ts"))}, output: { entryFileNames: "proof-client.js", chunkFileNames: "proof-client-[hash].js" } } } };`);
  const clientOutput = join(scratch, "client-proof");
  await command(resolve(example, "node_modules/.bin/vite"), ["build", "--config", clientConfig, "--outDir", clientOutput], example);
  await cp(clientOutput, join(output, "static"), { recursive: true });
  const functions = join(output, "functions");
  const base = join(functions, "demiurge.func");
  artifactHash = createHash("sha256").update(await readFile(join(base, "server/server-entry.js"))).digest("hex");
  for (const id of ["one", "two"]) {
    for (const representation of ["document", "navigation"] as const) {
      const name = `proof-${representation === "document" ? "doc" : "nav"}-${id}`;
      const directory = join(functions, `${name}.func`);
      await cp(base, directory, { recursive: true });
      await writeFile(join(directory, "index.mjs"), `import { createLiveListener } from "./server/server-entry.js";
const listener = createLiveListener(${JSON.stringify({ representation, logicalPath: `/public/${id}`, sourceOrigin, sourceToken, allowedHosts: [rollbackAlias] })});
export default (request, response) => {
  if (${isolated}) { const url = new URL(request.url, "https://proof.invalid"); url.searchParams.delete("__proof_representation"); request.url = url.pathname + url.search; }
  response.setHeader("x-proof-runtime", process.version);
  response.setHeader("x-proof-release", "original");
  response.setHeader("x-proof-wrapper", ${JSON.stringify(representation)});
  return listener(request, response);
};`);
      await writeFile(join(functions, `${name}.prerender-config.json`), JSON.stringify({ expiration: 10, group: id === "one" ? 481 : 482, allowQuery: isolated ? ["edition", "__proof_representation"] : ["edition"], passQuery: true, bypassToken: token }));
    }
  }
  await cp(base, join(functions, "raw-nav.func"), { recursive: true });
  await writeFile(join(functions, "raw-nav.func/index.mjs"), `import { createLiveListener } from "./server/server-entry.js";
const listener = createLiveListener(${JSON.stringify({ representation: "navigation", logicalPath: "/public/one", sourceOrigin, sourceToken })});
export default (request, response) => { request.url = "/public/one"; response.setHeader("x-proof-wrapper", "raw-navigation"); return listener(request, response); };`);
  for (const name of ["private", "nonce"]) {
    const directory = join(functions, `${name}.func`);
    await cp(base, directory, { recursive: true });
    await writeFile(join(directory, "index.mjs"), `import { createLiveListener } from "./server/server-entry.js";
export default createLiveListener(${JSON.stringify({ representation: "control", sourceOrigin, sourceToken })});`);
  }
  await rm(base, { recursive: true });
  await mkdir(join(functions, "reject.func"));
  await writeFile(join(functions, "reject.func/.vc-config.json"), JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs" }));
  await writeFile(join(functions, "reject.func/index.mjs"), 'export default (_request, response) => { response.writeHead(400, { "cache-control": "no-store" }); response.end("Ineligible proof request."); };');
  if (isolated) {
    const guard = join(functions, "proof-guard.func");
    await mkdir(guard);
    const guardConfig = join(scratch, "guard.vite.config.mjs");
    await writeFile(guardConfig, 'export default { build: { rollupOptions: { output: { entryFileNames: "index.js" } } } };');
    await command(resolve(example, "node_modules/.bin/vite"), ["build", "--config", guardConfig, "--ssr", resolve("tooling/vercel-isr-live-guard.ts"), "--outDir", guard], example);
    await writeFile(join(guard, ".vc-config.json"), JSON.stringify({ runtime: "edge", entrypoint: "index.js" }));
  }

  const routes = [
    ...(isolated ? [{ src: "^/public/.*$", middlewarePath: "proof-guard", continue: true }] : []),
    ...(await readdir(clientOutput)).filter((name) => /^proof-client(?:-[a-zA-Z0-9_-]+)?\.js$/.test(name)).map((name) => ({ src: `^/${name.replaceAll(".", "\\.")}$`, dest: `/${name}` })),
    { src: "^/proof-.*$", dest: "/reject" },
    { src: "^/public/.*$", has: [{ type: "header", key: "cookie" }], dest: "/reject" },
    { src: "^/public/.*$", has: [{ type: "header", key: "authorization" }], dest: "/reject" },
    { src: "^/public/(one|two)$", methods: ["GET", "HEAD"], has: [{ type: "header", key: "x-demiurge-navigation", value: "^data$" }], dest: isolated ? "/proof-nav-$1?__proof_representation=navigation" : "/proof-nav-$1" },
    { src: "^/public/(one|two)$", methods: ["GET", "HEAD"], missing: [{ type: "header", key: "x-demiurge-navigation" }], dest: isolated ? "/proof-doc-$1?__proof_representation=document" : "/proof-doc-$1" },
    { src: "^/raw-nav$", dest: "/raw-nav" },
    { src: "^/private$", dest: "/private" },
    { src: "^/nonce$", dest: "/nonce" },
    { src: "^/.*$", dest: "/reject" },
  ];
  routing = { version: 3, routes };
  await writeFile(join(output, "config.json"), JSON.stringify(routing));
  const prerenderTargets = (await readdir(functions)).filter((name) => name.endsWith(".prerender-config.json")).sort();
  assert.deepEqual(prerenderTargets, ["proof-doc-one.prerender-config.json", "proof-doc-two.prerender-config.json", "proof-nav-one.prerender-config.json", "proof-nav-two.prerender-config.json"]);
  await assertNoPublicCredentials(join(output, "static"), [token, sourceToken]);
  results.push({ name: "artifact-eligibility", prerenderTargets, privateControlExcluded: true, nonceControlExcluded: true, publicCredentialsAbsent: true, runtimeResponseValidation: true, arbitraryMiddlewareEligible: false, headerVariantsEligible: false });
  fullArtifactHash = await hashArtifact(output);
  console.log("Deploying isolated preview artifacts to demiurge-verification.");
  const deployed = await command("vercel", ["deploy", "--prebuilt", "--yes", "--cwd", scratch, "--scope", "north-shore-software-labs"], scratch);
  const matches = deployed.match(/https:\/\/[^\s]+\.vercel\.app/g);
  assert.ok(matches?.length);
  deployment = matches.at(-1)!;
  console.log(`Deployment ready: ${deployment}`);

  const request = async (name: string, path = "/public/one", headers: Record<string, string> = {}, method = "GET", timeout = "30", targetDeployment = deployment) => {
    assert.ok(path.startsWith("/") && !path.startsWith("//") && !/[\r\n]/.test(path));
    const startedAt = new Date().toISOString();
    const sequence = requestSequence++;
    const headerFile = join(scratch, `headers-${sequence}`);
    const bodyFile = join(scratch, `body-${sequence}`);
    const curlConfig = Object.entries({ "x-vercel-skip-toolbar": "1", ...headers }).map(([key, value]) => `header = ${JSON.stringify(`${key}: ${value}`)}`).join("\n");
    const status = await command("vercel", ["curl", path, "--deployment", targetDeployment, "--", "--silent", "--show-error", "--max-time", timeout, "--request", method, "--dump-header", headerFile, "--output", bodyFile, "--write-out", "%{http_code}", "--config", "-"], scratch, curlConfig);
    const rawHeaders = await readFile(headerFile, "utf8");
    const body = await readFile(bodyFile, "utf8");
    const get = (key: string) => new RegExp(`^${key}: (.*)$`, "im").exec(rawHeaders)?.[1].trim() ?? null;
    const row = {
      name, path, method, startedAt, finishedAt: new Date().toISOString(),
      requestHeaders: Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, ["cookie", "authorization", "x-prerender-revalidate"].includes(key.toLowerCase()) ? "[redacted]" : value])),
      status: Number(status.trim().slice(-3)),
      cache: get("x-vercel-cache"), age: get("age"), contentType: get("content-type"),
      release: get("x-proof-release"),
      layoutVersion: Number(/Layout version (\d+)/.exec(body)?.[1] ?? NaN),
      metadataVersion: Number(/Metadata version (\d+)/.exec(body)?.[1] ?? NaN),
      documentVersion: Number(/proof-document-v(\d+)/.exec(body)?.[1] ?? NaN),
      guard: get("x-proof-guard"), runtime: get("x-proof-runtime"),
      cacheControl: get("cache-control"), csp: get("content-security-policy"),
      wrapper: get("x-proof-wrapper"), navigationMarker: get("x-demiurge-navigation"), vary: get("vary"),
      bodyKind: body.trim().startsWith("{") ? "json" : body.includes("<html") ? "html" : "other",
      bodySha256: createHash("sha256").update(body).digest("hex"),
      setCookiePresent: get("set-cookie") !== null,
      privateIdentityMatches: path === "/private" ? body.includes(headers.cookie ?? "no-cookie-supplied") : null,
      hostileReflection: body.includes("synthetic-private") || body.includes("attacker.invalid"),
      id: /data-id="([^"]+)"/.exec(body)?.[1] ?? /"id":"([^"]+)"/.exec(body)?.[1] ?? null,
      nonceMatchesBody: nonceMatchesBody(get("content-security-policy"), body),
      generation: get("x-origin-generation"), middleware: get("x-origin-middleware"),
      version: Number(/data-version="(\d+)"/.exec(body)?.[1] ?? /"version":(\d+)/.exec(body)?.[1] ?? NaN),
      edition: /data-edition="([^"]+)"/.exec(body)?.[1] ?? /"edition":"([^"]+)"/.exec(body)?.[1] ?? null,
      sourceReads,
    };
    assert.ok(!body.includes(sourceToken) && !body.includes(token));
    results.push(row);
    await save();
    console.log(JSON.stringify(row));
    return row;
  };
  const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
  const doc = await request("cold-document");
  const hit = await request("repeat-document");
  await request("cold-navigation", "/public/one", { "x-demiurge-navigation": "data" });
  await request("repeat-navigation", "/public/one", { "x-demiurge-navigation": "data" });
  await request("raw-navigation", "/raw-nav");
  if (isolated) {
    await request("cold-cookie", "/public/two", { cookie: "session=synthetic-private" });
    await request("cold-authorization", "/public/two", { authorization: "Bearer synthetic-private" });
    await request("cold-unknown-query", "/public/two?preview=synthetic-private");
    await request("cold-duplicate-query", "/public/two?edition=a&edition=b");
    await request("cold-navigation-first", "/public/two", { "x-demiurge-navigation": "data" });
    await request("document-after-navigation", "/public/two");
    await request("repeat-navigation-first", "/public/two", { "x-demiurge-navigation": "data" });
    await request("unknown-query-second-path", "/public/two?preview=synthetic-private");
    await request("duplicate-query-second-path", "/public/two?edition=a&edition=b");
    await request("reserved-query", "/public/one?__proof_representation=navigation");
    await request("encoded-unknown-query", "/public/one?%70review=synthetic-private");
    await request("encoded-duplicate-query", "/public/one?edition=a&%65dition=b");
  }
  await request("second-path", "/public/two");
  await request("edition-a", "/public/one?edition=a");
  await request("edition-b", "/public/one?edition=b");
  await request("warm-before-security");
  await request("cookie-hit", "/public/one", { cookie: "session=synthetic-private" });
  await request("authorization-hit", "/public/one", { authorization: "Bearer synthetic-private" });
  await request("invalid-navigation", "/public/one", { "x-demiurge-navigation": "invalid" });
  await request("unknown-query", "/public/one?preview=synthetic-private");
  await request("duplicate-query", "/public/one?edition=a&edition=b");
  await request("hostile-headers", "/public/one", { "x-private-input": "synthetic-private", "x-forwarded-host": "attacker.invalid" });
  await request("direct-document-function", "/proof-doc-one");
  await request("direct-navigation-function", "/proof-nav-one");
  await request("mutation", "/public/one", {}, "POST");
  await request("private-control", "/private", { cookie: "session=synthetic-private" });
  await request("private-control-repeat", "/private", { cookie: "session=synthetic-other" });
  await request("nonce-control", "/nonce");
  await request("nonce-control-repeat", "/nonce");
  state.version = 2;
  console.log("Source version changed to 2; waiting for timed expiration.");
  await pause(11_000);
  await request("timed-stale");
  await pause(4_000);
  await request("timed-fresh");
  await request("timed-navigation", "/public/one", { "x-demiurge-navigation": "data" });
  state.version = 3;
  await request("explicit-revalidation", "/public/one", { "x-prerender-revalidate": token });
  await request("explicit-revalidation-repeat", "/public/one", { "x-prerender-revalidate": token });
  await pause(3_000);
  await request("explicit-document-result");
  await request("explicit-navigation-result", "/public/one", { "x-demiurge-navigation": "data" });
  state.fail = true;
  await request("failed-revalidation", "/public/one", { "x-prerender-revalidate": token });
  await pause(2_000);
  await request("failed-regeneration-stale");
  state.fail = false;
  state.version = 4;
  console.log("Source recovered at version 4; waiting across the documented retry interval.");
  await pause(31_000);
  await request("retry-trigger");
  await pause(4_000);
  await request("retry-result");
  state.version = 5;
  state.delayMs = 4_000;
  const beforeRace = sourceReads;
  const raceDocument = request("race-document-revalidation", "/public/one", { "x-prerender-revalidate": token });
  for (let attempt = 0; attempt < 100 && sourceReads <= beforeRace; attempt++) await pause(100);
  state.version = 6;
  const raceNavigation = request("race-navigation-revalidation", "/public/one", { "x-demiurge-navigation": "data", "x-prerender-revalidate": token });
  await Promise.all([raceDocument, raceNavigation]);
  state.delayMs = 0;
  await request("race-document-result");
  await request("race-navigation-result", "/public/one", { "x-demiurge-navigation": "data" });
  await request("invalid-bypass", "/public/one", { cookie: "__prerender_bypass=invalid" });
  await request("valid-bypass", "/public/one", { cookie: `__prerender_bypass=${token}` });
  await request("public-after-bypass");
  if (isolated) {
    state.version = 7;
    state.delayMs = 4_000;
    let transportFailed = false;
    try {
      await request("lost-acknowledgment-response", "/public/one", { "x-prerender-revalidate": token }, "GET", "1");
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("curl: (28)")) throw error;
      transportFailed = true;
    }
    results.push({ name: "lost-acknowledgment", transportFailed, transportFailure: transportFailed ? "curl-timeout-28" : null, acknowledgment: transportFailed ? "unknown" : "received" });
    await pause(6_000);
    results.push({ name: "lost-acknowledgment-origin", observed: sourceEvents.some((event) => event.version === 7), observedAt: new Date().toISOString() });
    state.delayMs = 0;
    await request("lost-acknowledgment-observation");
    await request("lost-acknowledgment-retry", "/public/one", { "x-prerender-revalidate": token });
    await request("lost-acknowledgment-result");
    await verifyBrowser({ scratch, deployment, results, save });
    await verifyRollback({ scratch, output, deployment, alias: rollbackAlias, state, sourceEvents, request, results, save, token });
  }
  const failures = isolated ? assessCompletion(results) : assess(results);
  results.push({ summary: "Live observations completed.", sameGenerationOnRepeat: doc.generation === hit.generation, sourceReads, failures });
  if (failures.length) process.exitCode = 1;
  await save();
  console.log(`Live evidence saved: ${evidenceFile}`);
} catch (error) {
  results.push({ failure: error instanceof Error ? error.message.replaceAll(token, "[redacted]").replaceAll(sourceToken, "[redacted]") : "The live probe failed." });
  await save();
  throw error;
} finally {
  tunnel?.kill("SIGTERM");
  if (source.listening) await new Promise<void>((done) => source.close(() => done()));
  await rm(scratch, { force: true, recursive: true });
}

async function save() {
  await writeFile(evidenceFile, JSON.stringify({ sourceBaseline, sourceCommit, routing, prerender: { expiration: 10, groups: [481, 482], allowQuery: isolated ? ["edition", "__proof_representation"] : ["edition"], passQuery: true, bypassToken: "[redacted]" }, candidate: isolated ? "complete-private-vercel-proof" : "original", workingTreeSources, artifactHash, fullArtifactHash, deployment, runtime: "nodejs22.x", region: "iad1", expiration: 10, groups: [481, 482], sourceEvents, results }, null, 2));
}

function command(binary: string, args: string[], cwd: string, input = ""): Promise<string> {
  return new Promise((done, reject) => {
    const child = spawn(binary, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data: string) => { output += data; });
    child.stderr.on("data", (data: string) => { errors += data; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? done(output) : reject(new Error(`${binary} failed with ${code}: ${errors}`)));
    child.stdin.end(input);
  });
}

async function hashArtifact(directory: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const file = join(current, entry.name);
      if (entry.isDirectory()) await visit(file);
      else { hash.update(file.slice(directory.length)); hash.update("\0"); hash.update(await readFile(file)); }
    }
  }
  await visit(directory);
  return hash.digest("hex");
}

function assess(rows: readonly Record<string, unknown>[]): string[] {
  const named = (name: string) => rows.find((row) => row.name === name);
  const failures = [];
  if (named("cold-navigation")?.contentType !== "application/json") failures.push("Navigation representation isolation failed.");
  if (named("race-document-result")?.contentType !== "text/html; charset=utf-8") failures.push("Document representation isolation failed after revalidation.");
  if (named("unknown-query")?.status !== 400) failures.push("Unknown query rejection failed.");
  return failures;
}

async function assertNoPublicCredentials(directory: string, credentials: string[]): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await assertNoPublicCredentials(file, credentials);
    else {
      const contents = await readFile(file);
      for (const credential of credentials) assert.ok(!contents.includes(Buffer.from(credential)), "Public assets contain a probe credential.");
    }
  }
}
