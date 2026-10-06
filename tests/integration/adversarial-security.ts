import { spawn } from "node:child_process";
import { resolve } from "node:path";

const secretSentinel = "adversarial-server-secret-7f31c9";
const child = spawn(process.execPath, ["server.js"], {
  cwd: resolve("examples/adversarial-security"),
  env: { ...process.env, HOST: "127.0.0.1", NODE_ENV: "production", PORT: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk: string) => { stderr += chunk; });

try {
  const origin = await waitForOrigin(child);
  const alice = identity("alice", "red");
  const bob = identity("bob", "red");
  const [aliceDocument, bobDocument] = await Promise.all([
    fetch(`${origin}/secure/record`, { headers: alice }),
    fetch(`${origin}/secure/record`, { headers: bob }),
  ]);
  const [aliceHtml, bobHtml] = await Promise.all([aliceDocument.text(), bobDocument.text()]);
  assertEqual(aliceDocument.status, 200, "Alice document status");
  assertEqual(bobDocument.status, 200, "Bob document status");
  assertIncludes(aliceHtml, "alice in red", "Alice document identity");
  assertIncludes(bobHtml, "bob in red", "Bob document identity");
  assertIncludes(aliceHtml, "data-load=\"1\"", "Alice isolated cache load");
  assertIncludes(bobHtml, "data-load=\"1\"", "Bob isolated cache load");
  assertExcludes(aliceHtml, secretSentinel, "Alice document");
  assertExcludes(bobHtml, secretSentinel, "Bob document");

  const [aliceNavigation, bobNavigation] = await Promise.all([
    fetch(`${origin}/secure/record`, { headers: { ...alice, "x-demiurge-navigation": "data" } }),
    fetch(`${origin}/secure/record`, { headers: { ...bob, "x-demiurge-navigation": "data" } }),
  ]);
  const [aliceData, bobData] = await Promise.all([aliceNavigation.text(), bobNavigation.text()]);
  assertEqual(aliceNavigation.status, 200, "Alice navigation status");
  assertEqual(bobNavigation.status, 200, "Bob navigation status");
  assertIncludes(aliceData, '"userId":"alice"', "Alice navigation identity");
  assertIncludes(bobData, '"userId":"bob"', "Bob navigation identity");
  assertIncludes(aliceData, '"load":1', "Alice repeated cache load");
  assertIncludes(bobData, '"load":1', "Bob repeated cache load");
  assertExcludes(aliceData, secretSentinel, "Alice navigation payload");
  assertExcludes(bobData, secretSentinel, "Bob navigation payload");

  const [anonymousDocument, anonymousNavigation] = await Promise.all([
    fetch(`${origin}/secure/record`),
    fetch(`${origin}/secure/record`, { headers: { "x-demiurge-navigation": "data" } }),
  ]);
  assertEqual(anonymousDocument.status, 403, "Anonymous document status");
  assertEqual(anonymousNavigation.status, 403, "Anonymous navigation status");

  const crossTenant = await fetch(`${origin}/secure/record?tenant=blue`, { headers: alice });
  assertEqual(crossTenant.status, 404, "Cross-tenant status");
  assertExcludes(await crossTenant.text(), secretSentinel, "Cross-tenant response");

  const oversized = await fetch(`${origin}/api/limited`, {
    body: "x".repeat(33),
    headers: { "content-length": "33" },
    method: "POST",
  });
  assertEqual(oversized.status, 413, "Oversized body status");
  const effects = await fetch(`${origin}/api/effects`);
  const effectPayload = await effects.json() as { acceptedBodies: number };
  assertEqual(effectPayload.acceptedBodies, 0, "Oversized body effect count");

  const forgedAddress = "203.0.113.77";
  const proxy = await fetch(`${origin}/api/proxy`, {
    headers: {
      "x-forwarded-for": forgedAddress,
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
    },
  });
  const proxyPayload = await proxy.json() as {
    clientAddress: string;
    forwardedFor: string;
    origin: string;
  };
  assertEqual(proxy.status, 200, "Proxy request status");
  assertEqual(proxyPayload.forwardedFor, forgedAddress, "Forwarded header presence");
  assertNotEqual(proxyPayload.clientAddress, forgedAddress, "Forged client address");
  assertEqual(proxyPayload.origin, origin, "Forged origin");

  console.log("adversarial security probe passed");
} finally {
  child.kill("SIGTERM");
  await new Promise<void>((resolveExit) => {
    if (child.exitCode !== null) return resolveExit();
    child.once("exit", () => resolveExit());
  });
}

function identity(user: string, tenant: string) {
  return { "x-fixture-tenant": tenant, "x-fixture-user": user };
}

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
}

function assertNotEqual(actual: unknown, unexpected: unknown, label: string) {
  if (actual === unexpected) throw new Error(`${label} unexpectedly received ${JSON.stringify(unexpected)}.`);
}

function assertIncludes(value: string, fragment: string, label: string) {
  if (!value.includes(fragment)) throw new Error(`${label} omitted ${JSON.stringify(fragment)}.`);
}

function assertExcludes(value: string, fragment: string, label: string) {
  if (value.includes(fragment)) throw new Error(`${label} included ${JSON.stringify(fragment)}.`);
}

function waitForOrigin(process: ReturnType<typeof spawn>) {
  return new Promise<string>((resolveOrigin, rejectOrigin) => {
    const timeout = setTimeout(() => rejectOrigin(
      new Error(`Adversarial security server did not start in time. ${stderr}`),
    ), 10_000);
    process.stdout?.setEncoding("utf8");
    process.stdout?.on("data", (chunk: string) => {
      const match = /listening on (http:\/\/[^\s]+)/.exec(chunk);
      if (match) {
        clearTimeout(timeout);
        resolveOrigin(match[1]);
      }
    });
    process.once("exit", (code) => {
      clearTimeout(timeout);
      rejectOrigin(new Error(`Adversarial security server exited with code ${code}. ${stderr}`));
    });
  });
}
