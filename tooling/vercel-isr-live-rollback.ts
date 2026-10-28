import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Row = Record<string, unknown>;
type Options = {
  scratch: string;
  output: string;
  deployment: string;
  alias: string;
  token: string;
  state: { version: number; fail: boolean; delayMs: number };
  request: (name: string, path?: string, headers?: Record<string, string>, method?: string, timeout?: string, target?: string) => Promise<Row>;
  results: Row[];
  save: () => Promise<void>;
  sourceEvents: Array<{ version: number; fail: boolean; at: string }>;
};

export async function verifyRollback(options: Options): Promise<void> {
  const { scratch, output, deployment, alias, token, state, request, results, save, sourceEvents } = options;
  assert.match(alias, /^demiurge-isr-rollback-\d+\.vercel\.app$/);
  const scope = ["--scope", "north-shore-software-labs"];
  let replacement = "";
  let aliasCreated = false;
  let cleanupFailure: unknown;
  const observeRelease = async (name: string, release: string, target: string, navigation = false, version?: number, cache?: string): Promise<Row> => {
    for (let attempt = 0; attempt < 15; attempt++) {
      const row = await request(`${name}-attempt-${attempt}`, "/public/two", navigation ? { "x-demiurge-navigation": "data" } : {}, "GET", "30", target);
      if (row.release === release && (version === undefined || row.version === version) && (cache === undefined || row.cache === cache)) {
        row.name = name;
        await save();
        return row;
      }
    }
    throw new Error(`The alias did not expose the expected ${name} observation.`);
  };
  try {
    for (const entry of await readdir(join(output, "functions"))) {
      if (!/^proof-(doc|nav)-(one|two)\.func$/.test(entry)) continue;
      const file = join(output, "functions", entry, "index.mjs");
      const source = await readFile(file, "utf8");
      assert.ok(source.includes('"x-proof-release", "original"'));
      await writeFile(file, source.replace('"x-proof-release", "original"', '"x-proof-release", "replacement"'));
    }
    const configFile = join(output, "config.json");
    const routing = await readFile(configFile, "utf8");
    assert.ok(routing.includes("__proof_representation=document-original"));
    assert.ok(routing.includes("__proof_representation=navigation-original"));
    await writeFile(configFile, routing.replaceAll("__proof_representation=document-original", "__proof_representation=document-replacement").replaceAll("__proof_representation=navigation-original", "__proof_representation=navigation-replacement"));
    const deployed = await command("vercel", ["deploy", "--prebuilt", "--yes", "--cwd", scratch, ...scope], scratch);
    const matches = deployed.match(/https:\/\/[^\s]+\.vercel\.app/g);
    assert.ok(matches?.length);
    replacement = matches.at(-1)!;
    results.push({ name: "rollback-deployments", original: deployment, replacement, alias, productionChanged: false, explicitDeploymentNamespace: true, replacementArtifactHash: await hashArtifact(output) });
    await save();
    await command("vercel", ["alias", "set", deployment, alias, ...scope], scratch);
    aliasCreated = true;
    state.version = 8;
    const original = await observeRelease("rollback-original", "original", `https://${alias}`);
    assert.equal(original.release, "original");
    await observeRelease("rollback-original-navigation", "original", `https://${alias}`, true);
    await observeRelease("rollback-original-hit", "original", `https://${alias}`, false, undefined, "HIT");
    await command("vercel", ["alias", "set", replacement, alias, ...scope], scratch);
    state.version = 9;
    const forward = await observeRelease("rollback-forward", "replacement", `https://${alias}`, false, 9);
    assert.equal(forward.release, "replacement");
    assert.equal(forward.version, 9);
    const forwardNavigation = await observeRelease("rollback-forward-navigation", "replacement", `https://${alias}`, true, 9);
    assert.equal(forwardNavigation.release, "replacement");
    assert.equal(forwardNavigation.version, 9);
    await observeRelease("rollback-forward-hit", "replacement", `https://${alias}`, false, 9, "HIT");
    state.version = 10;
    state.delayMs = 12_000;
    const pending = request("rollback-inflight-generation", "/public/two", { "x-prerender-revalidate": token }, "GET", "30", replacement).then((value) => ({ value }), (error: unknown) => ({ error }));
    for (let attempt = 0; attempt < 100 && !sourceEvents.some((event) => event.version === 10); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(sourceEvents.some((event) => event.version === 10));
    results.push({ name: "rollback-generation-started", version: 10, sourceStartedAt: sourceEvents.find((event) => event.version === 10)!.at, observedAt: new Date().toISOString() });
    await command("vercel", ["alias", "set", deployment, alias, ...scope], scratch);
    results.push({ name: "rollback-alias-restored", completedAt: new Date().toISOString() });
    const outcome = await pending;
    if ("error" in outcome) throw outcome.error;
    const completed = outcome.value;
    assert.equal(completed.release, "replacement");
    assert.equal(completed.version, 10);
    state.delayMs = 0;
    const restored = await observeRelease("rollback-restored", "original", `https://${alias}`);
    const restoredNavigation = await observeRelease("rollback-restored-navigation", "original", `https://${alias}`, true);
    assert.equal(restored.release, "original");
    assert.equal(restoredNavigation.release, "original");
    const replacementAfter = await request("rollback-replacement-retained", "/public/two", {}, "GET", "30", replacement);
    assert.equal(replacementAfter.release, "replacement");
    results.push({ name: "rollback-scope", aliasRestored: true, originalVersion: original.version, restoredVersion: restored.version, replacementVersion: replacementAfter.version, globalPropagationVerified: false, atomicPublicationVerified: false });
    await save();
  } finally {
    const cleanup = await Promise.allSettled([
      ...(aliasCreated ? [command("vercel", ["alias", "remove", alias, "--yes", ...scope], scratch).then(() => {
        results.push({ name: "rollback-alias-cleanup", removed: true });
      })] : []),
      ...(replacement ? [command("vercel", ["remove", replacement, "--yes", ...scope], scratch).then(() => {
        results.push({ name: "rollback-replacement-cleanup", removed: true });
      })] : []),
    ]);
    await save();
    const failed = cleanup.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") cleanupFailure = failed.reason;
  }
  if (cleanupFailure) throw cleanupFailure;
}

function command(binary: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk: Buffer) => { output += String(chunk); });
    child.stderr.on("data", (chunk: Buffer) => { errors += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(output) : reject(new Error(`${binary} failed with ${code}: ${errors}`)));
  });
}

async function hashArtifact(directory: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(current: string): Promise<void> {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const file = join(current, entry.name);
      if (entry.isDirectory()) await visit(file);
      else { hash.update(file.slice(directory.length)); hash.update("\0"); hash.update(await readFile(file)); }
    }
  }
  await visit(directory);
  return hash.digest("hex");
}
