import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { createVercelFunction } from "@demiurgejs/core/vercel";
import { createHandler } from "../examples/vercel-node/tests/node-live-entry";
import { assessNodeLive } from "./vercel-node-live-assessment";

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

void test("the production fixture preserves nonce, cookie, lifecycle, and cancellation boundaries", async () => {
  const events: string[] = [];
  const collector = createServer((request, response) => {
    assert.equal(request.headers.authorization, "Bearer event-token");
    events.push(new URL(request.url!, "http://collector.invalid").searchParams.get("event")!);
    response.end("recorded");
  });
  const eventOrigin = await listen(collector);
  const oldOrigin = process.env.PROOF_EVENT_ORIGIN;
  const oldToken = process.env.PROOF_EVENT_TOKEN;
  process.env.PROOF_EVENT_ORIGIN = eventOrigin;
  process.env.PROOF_EVENT_TOKEN = "event-token";
  const listener = createVercelFunction({
    allowedHosts: ["127.0.0.1"], cacheStore: "unavailable", rateLimitStore: "unavailable",
    createHandler, manifest: { clientEntry: "/entry.js", styles: [] },
  });
  const server = createServer((request, response) => { void listener(request, response); });
  try {
    const origin = await listen(server);
    const first = await fetch(origin);
    const second = await fetch(origin);
    assert.equal(first.headers.get("cache-control"), "private, no-store");
    assert.equal(first.headers.get("vercel-cdn-cache-control"), "no-store");
    assert.notEqual(first.headers.get("content-security-policy"), second.headers.get("content-security-policy"));
    const nonce = /'nonce-([^']+)'/.exec(first.headers.get("content-security-policy")!)?.[1];
    assert.ok(nonce);
    assert.ok((await first.text()).includes(`nonce="${nonce}"`));
    await second.body?.cancel();
    const cookies = await fetch(`${origin}/probe/cookies`);
    assert.equal(cookies.headers.getSetCookie().length, 2);
    await cookies.body?.cancel();
    const capabilities = await fetch(`${origin}/probe/capabilities`);
    const body: unknown = await capabilities.json();
    assert.ok(typeof body === "object" && body !== null && "backgroundRejected" in body && body.backgroundRejected === true);
    const controller = new AbortController();
    const stream = await fetch(`${origin}/probe/stream?id=cancel`, { signal: controller.signal });
    const reader = stream.body!.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), "started\n");
    controller.abort();
    for (let attempt = 0; attempt < 20 && !events.includes("aborted"); attempt++) await new Promise((done) => setTimeout(done, 10));
    assert.ok(events.includes("started"));
    assert.ok(events.includes("aborted"));
    assert.equal(events.includes("completed"), false);
  } finally {
    if (oldOrigin === undefined) delete process.env.PROOF_EVENT_ORIGIN; else process.env.PROOF_EVENT_ORIGIN = oldOrigin;
    if (oldToken === undefined) delete process.env.PROOF_EVENT_TOKEN; else process.env.PROOF_EVENT_TOKEN = oldToken;
    server.closeAllConnections(); collector.closeAllConnections();
    await Promise.all([new Promise<void>((done) => server.close(() => done())), new Promise<void>((done) => collector.close(() => done()))]);
  }
});

void test("the saved-record assessment rejects absent observations", () => {
  const failures = assessNodeLive([]);
  assert.ok(failures.includes("The origin did not observe request cancellation."));
  assert.ok(failures.includes("The provider did not deliver a response before streaming completed."));
  assert.ok(failures.includes("Repeated Set-Cookie headers were lost."));
  assert.ok(failures.includes("The artifact has incorrect lifecycle claims."));
});

void test("the saved-record assessment rejects each missing provider proof", () => {
  const base = {
    status: 200, contentType: "text/html; charset=utf-8", cacheControl: "private, no-store", cache: "MISS",
    csp: "script-src 'nonce-first'", nosniff: "nosniff", generation: "first", runtime: "v22.23.2", cookies: [],
    body: '<script nonce="first"></script>', firstByteMs: 50, totalMs: 100,
  };
  const rows = [
    { ...base, name: "document-first" },
    { ...base, name: "document-second", csp: "script-src 'nonce-second'", body: '<script nonce="second"></script>', generation: "second" },
    { ...base, name: "cookies", cookies: ["proof-a=[redacted]; HttpOnly", "proof-b=[redacted]; HttpOnly"] },
    { ...base, name: "navigation", contentType: "application/json" },
    { ...base, name: "private-one", privateIdentityMatches: true, body: "[redacted]" },
    { ...base, name: "private-two", privateIdentityMatches: true, body: "[redacted]" },
    { ...base, name: "request", body: JSON.stringify({ pathname: "/probe/request", search: "?edition=one&edition=two", address: "198.51.100.1" }) },
    { ...base, name: "stream", body: `started\n${"continued\n".repeat(7)}`, totalMs: 7000 },
    { ...base, name: "cancelled-stream", body: "started\n" },
    { ...base, name: "capabilities", body: JSON.stringify({ backgroundLifetime: false, responseBodyCompletion: true, streaming: true, backgroundRejected: true }) },
  ];
  const events = [{ id: "complete", event: "completed" }, { id: "cancel", event: "started" }, { id: "cancel", event: "aborted" }];
  assert.deepEqual(assessNodeLive(rows, events), []);
  for (const row of rows) assert.ok(assessNodeLive(rows.filter((candidate) => candidate !== row), events).length > 0, row.name);
  for (const event of events) assert.ok(assessNodeLive(rows, events.filter((candidate) => candidate !== event)).length > 0, event.event);
  assert.ok(assessNodeLive(rows.map((row) => row.name === "document-second" ? { ...row, generation: "first" } : row), events).includes("Repeated documents reused a generation."));
  assert.ok(assessNodeLive(rows.map((row) => row.name === "private-two" ? { ...row, privateIdentityMatches: false } : row), events).includes("A private response lost its identity or storage exclusion."));
});
