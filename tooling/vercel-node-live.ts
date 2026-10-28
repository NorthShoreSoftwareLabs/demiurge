import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateVercelNodeOutput, vercelNode } from "@demiurgejs/core/vercel";
import { assessNodeLive, type NodeLiveRow } from "./vercel-node-live-assessment";

const assessmentIndex = process.argv.indexOf("--assess");
if (assessmentIndex >= 0) {
  const record = JSON.parse(await readFile(process.argv[assessmentIndex + 1], "utf8"));
  assert.ok(Array.isArray(record.results));
  const failures = assessNodeLive(record.results, record.events);
  console.log(JSON.stringify({ passed: failures.length === 0, failures }, null, 2));
  process.exit(failures.length ? 1 : 0);
}
if (!process.argv.includes("--run")) throw new Error("Pass --run to deploy the dedicated production verification fixture.");

const scratch = await mkdtemp(join(tmpdir(), "demiurge-node-live-"));
const example = resolve("examples/vercel-node");
const evidenceFile = join(tmpdir(), `demiurge-node-live-${Date.now()}.json`);
const sourceBaseline = (await command("git", ["rev-parse", "HEAD"], process.cwd())).trim();
const sources = ["tooling/vercel-node-live.ts", "tooling/vercel-node-live-assessment.ts", "examples/vercel-node/tests/node-live-entry.ts"];
const workingTreeSources = Object.fromEntries(await Promise.all(sources.map(async (file) => [file, createHash("sha256").update(await readFile(file)).digest("hex")])));
const sourceCommit = (await command("git", ["status", "--porcelain", "--", ...sources], process.cwd())).trim() === "" ? sourceBaseline : null;
const results: NodeLiveRow[] = [];
let deployment = "";
let artifactHash = "";
let errorMessage: string | null = null;
let cleanupComplete = false;
const eventToken = randomBytes(32).toString("hex");
const events: Array<{ id: string; event: string; at: string }> = [];
const collector = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://collector.invalid");
  if (request.method !== "GET" || url.pathname !== "/event" || request.headers.authorization !== `Bearer ${eventToken}`) {
    response.writeHead(404).end(); return;
  }
  events.push({ id: url.searchParams.get("id") ?? "", event: url.searchParams.get("event") ?? "", at: new Date().toISOString() });
  response.writeHead(200, { "cache-control": "no-store" }).end("recorded");
});
let tunnel: ReturnType<typeof spawn> | undefined;
try {
  const project = JSON.parse(await readFile(join(example, ".vercel/project.json"), "utf8"));
  assert.equal(project.projectName, "demiurge-verification");
  assert.equal(project.projectId, "prj_T5AAGBC2CMAKeh5FkfDlVg96PARF");
  await mkdir(join(scratch, ".vercel"));
  await writeFile(join(scratch, ".vercel/project.json"), JSON.stringify(project));
  await symlink(join(example, "node_modules"), join(scratch, "node_modules"), "dir");
  await new Promise<void>((done, reject) => { collector.once("error", reject); collector.listen(0, "127.0.0.1", done); });
  const address = collector.address();
  assert.ok(address && typeof address !== "string");
  tunnel = spawn("ngrok", ["http", String(address.port), "--log", "stdout", "--log-format", "json", "--inspect=false"], { stdio: ["ignore", "pipe", "pipe"] });
  const eventOrigin = await new Promise<string>((done, reject) => {
    const timeout = setTimeout(() => reject(new Error("The event collector tunnel did not start.")), 30000);
    const receive = (chunk: Buffer) => {
      const message = String(chunk);
      const match = /"url":"(https:\/\/[^"]+)"/.exec(message);
      if (match) { clearTimeout(timeout); done(match[1]); }
      if (message.includes('"lvl":"eror"') || message.includes("ERR_NGROK")) {
        clearTimeout(timeout); reject(new Error("The event collector tunnel failed."));
      }
    };
    tunnel!.stdout!.on("data", receive); tunnel!.stderr!.on("data", receive);
    tunnel!.once("error", reject);
  });
  const config = join(scratch, "vite.config.mjs");
  await writeFile(config, 'export default { build: { rollupOptions: { external: [/^@demiurgejs\\/core(?:\\/|$)/, /^react(?:\\/|$)/], output: { entryFileNames: "server-entry.js" } } } };');
  const serverDir = join(scratch, "server");
  await command(join(example, "node_modules/.bin/vite"), ["build", "--config", config, "--ssr", join(example, "tests/node-live-entry.ts"), "--outDir", serverDir], example);
  const output = await generateVercelNodeOutput({ projectRoot: scratch, clientDir: join(example, "dist/client"), serverDir, deployment: vercelNode({ runtime: "nodejs22.x", maxDuration: 60, regions: ["iad1"] }) });
  const entry = join(output, "functions/demiurge.func/index.mjs");
  await writeFile(entry, `process.env.PROOF_EVENT_ORIGIN = ${JSON.stringify(eventOrigin)};\nprocess.env.PROOF_EVENT_TOKEN = ${JSON.stringify(eventToken)};\n${await readFile(entry, "utf8")}`);
  artifactHash = await hashArtifact(output);
  const deployed = await command("vercel", ["deploy", "--prebuilt", "--yes", "--cwd", scratch, "--scope", "north-shore-software-labs"], scratch);
  const matches = deployed.match(/https:\/\/[^\s]+\.vercel\.app/g);
  assert.ok(matches?.length);
  deployment = matches.at(-1)!;
  console.log(`Production fixture ready: ${deployment}`);
  await request("document-first", "/");
  await request("document-second", "/");
  await request("navigation", "/", { "x-demiurge-navigation": "data" });
  await request("cookies", "/probe/cookies");
  await request("private-one", "/probe/private", { cookie: "proof=one" });
  await request("private-two", "/probe/private", { cookie: "proof=two" });
  await request("request", "/probe/request?edition=one&edition=two", { "x-vercel-forwarded-for": "203.0.113.123" });
  await request("capabilities", "/probe/capabilities");
  await request("stream", "/probe/stream?id=complete");
  await request("cancelled-stream", "/probe/stream?id=cancel", {}, true);
  for (let attempt = 0; attempt < 16 && !events.some((event) => event.id === "cancel" && event.event === "aborted"); attempt++) {
    await new Promise((done) => setTimeout(done, 500));
  }
  const failures = assessNodeLive(results, events);
  if (failures.length) { errorMessage = failures.join(" "); process.exitCode = 1; }
} catch (error) {
  errorMessage = error instanceof Error ? error.message.replaceAll(eventToken, "[redacted]") : "The production verification failed.";
  process.exitCode = 1;
} finally {
  if (deployment) {
    try {
      await command("vercel", ["remove", deployment, "--yes", "--scope", "north-shore-software-labs"], scratch);
      cleanupComplete = true;
    } catch { errorMessage = `${errorMessage ?? ""} The temporary deployment requires removal.`.trim(); process.exitCode = 1; }
  }
  tunnel?.kill("SIGTERM");
  if (collector.listening) await new Promise<void>((done) => collector.close(() => done()));
  await writeFile(evidenceFile, JSON.stringify({ sourceBaseline, sourceCommit, workingTreeSources, artifactHash, deployment, runtime: "nodejs22.x", region: "iad1", observedAt: new Date().toISOString(), results, events, errorMessage, cleanupComplete, limits: ["One region was observed.", "No process shutdown or durable background lifetime is claimed.", "No shared external store was configured."] }, null, 2));
  console.log(`Production evidence saved: ${evidenceFile}`);
  await rm(scratch, { force: true, recursive: true });
}

async function request(name: string, path: string, headers: Record<string, string> = {}, cancel = false) {
  const index = results.length;
  const headerFile = join(scratch, `headers-${index}`);
  const bodyFile = join(scratch, `body-${index}`);
  const config = Object.entries(headers).map(([key, value]) => `header = ${JSON.stringify(`${key}: ${value}`)}`).join("\n");
  const output = await command("vercel", ["curl", path, "--deployment", deployment, "--", "--silent", "--show-error", "--max-time", cancel ? "0.5" : "30", "--dump-header", headerFile, "--output", bodyFile, "--write-out", "%{http_code} %{time_starttransfer} %{time_total}", "--config", "-"], scratch, config, cancel);
  const rawHeaders = await readFile(headerFile, "utf8");
  const body = await readFile(bodyFile, "utf8");
  const get = (key: string) => new RegExp(`^${key}: (.*)$`, "im").exec(rawHeaders)?.[1].trim() ?? null;
  const metrics = /(\d{3}) ([\d.]+) ([\d.]+)\s*$/.exec(output);
  assert.ok(metrics, "The HTTP timing evidence is missing.");
  const row: NodeLiveRow = { name, status: Number(metrics[1]), firstByteMs: Number(metrics[2]) * 1000, totalMs: Number(metrics[3]) * 1000, contentType: get("content-type"), cacheControl: get("cache-control"), cache: get("x-vercel-cache"), csp: get("content-security-policy"), nosniff: get("x-content-type-options"), generation: get("x-proof-generation"), runtime: get("x-proof-runtime"), cookies: [...rawHeaders.matchAll(/^set-cookie: (.*)$/gim)].map((match) => match[1].trim().replace(/=[^;]*/, "=[redacted]")), body: name.startsWith("private-") ? "[redacted]" : body, ...(name.startsWith("private-") ? { privateIdentityMatches: body.includes(headers.cookie) } : {}) };
  results.push(row);
  console.log(JSON.stringify({ name, status: row.status, firstByteMs: row.firstByteMs, totalMs: row.totalMs }));
}

function command(binary: string, args: string[], cwd: string, input = "", acceptTimeout = false): Promise<string> {
  return new Promise((done, reject) => {
    const child = spawn(binary, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data: string) => { output += data; });
    child.stderr.on("data", (data: string) => { errors += data; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 || (acceptTimeout && errors.includes("curl: (28)")) ? done(output) : reject(new Error(`${binary} failed with ${code}: ${errors}`)));
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
