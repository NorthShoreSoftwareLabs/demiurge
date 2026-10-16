import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import { nonceMatchesBody } from "./vercel-isr-live-security";
import {
  createLiveListener,
  type LiveListenerOptions,
} from "../examples/vercel-node/tests/isr-live-entry";

void test("nonce evidence requires body nonces and complete policy sources", () => {
  const policy = "script-src 'nonce-abcdef'; style-src 'nonce-other'";
  assert.equal(nonceMatchesBody(policy, "<html></html>"), false);
  assert.equal(nonceMatchesBody(policy, '<script nonce="abc"></script>'), false);
  assert.equal(nonceMatchesBody(policy, '<script nonce="abcdef"></script>'), true);
  assert.equal(nonceMatchesBody(policy, '<script nonce="abcdef"></script><style nonce="other"></style>'), true);
  assert.equal(nonceMatchesBody(policy, '<script nonce="abcdef"></script><style nonce="missing"></style>'), false);
  assert.equal(nonceMatchesBody("script-src x'nonce-abcdef'", '<script nonce="abcdef"></script>'), false);
  assert.equal(nonceMatchesBody(null, '<script nonce="abcdef"></script>'), null);
  assert.equal(nonceMatchesBody("script-src 'self'", "<html></html>"), null);
});

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The test server address is unavailable.");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

void test("the live ISR fixture preserves its local response contracts", async (context) => {
  const originalHost = process.env.VERCEL_URL;
  const originalProductionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const servers: Server[] = [];
  let version = 1;
  let reads = 0;
  const source = createServer((request, response) => {
    if (request.url !== "/state" || request.headers.authorization !== "Bearer fixture-token") {
      response.writeHead(401).end();
      return;
    }
    reads++;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ version, fail: false, delayMs: 0 }));
  });
  servers.push(source);
  try {
    process.env.VERCEL_URL = "127.0.0.1";
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    const sourceOrigin = await listen(source);
    const start = async (representation: LiveListenerOptions["representation"]) => {
      const server = createServer(createLiveListener({ representation, sourceOrigin, sourceToken: "fixture-token" }));
      servers.push(server);
      return listen(server);
    };
    const documentOrigin = await start("document");
    const navigationOrigin = await start("navigation");
    const controlOrigin = await start("control");

    await context.test("documents isolate generations and deduplicate source reads", async () => {
      const before = reads;
      const first = await fetch(`${documentOrigin}/public/one?edition=blue`);
      assert.equal(first.status, 200);
      assert.match(first.headers.get("content-type") ?? "", /^text\/html/);
      const firstBody = await first.text();
      assert.match(firstBody, /data-version="1"/);
      assert.match(firstBody, /data-id="one"/);
      assert.match(firstBody, /data-edition="blue"/);
      assert.equal(reads, before + 1);
      version = 2;
      const second = await fetch(`${documentOrigin}/public/one?edition=blue`);
      assert.match(await second.text(), /data-version="2"/);
      assert.notEqual(second.headers.get("x-origin-generation"), first.headers.get("x-origin-generation"));
      assert.equal(reads, before + 2);
    });

    await context.test("navigation returns JSON with the navigation response marker", async () => {
      const before = reads;
      const response = await fetch(`${navigationOrigin}/public/two?edition=green`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/json");
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("x-demiurge-navigation"), "data");
      assert.match(response.headers.get("vary") ?? "", /x-demiurge-navigation/);
      const body: unknown = await response.json();
      assert.ok(typeof body === "object" && body !== null && "data" in body);
      const data = body.data;
      assert.ok(typeof data === "object" && data !== null && "version" in data && "id" in data && "edition" in data);
      assert.equal(data.version, 2);
      assert.equal(data.id, "two");
      assert.equal(data.edition, "green");
      assert.equal(reads, before + 1);
    });

    await context.test("private controls preserve each identity and prohibit storage", async () => {
      for (const identity of ["first", "second"]) {
        const response = await fetch(`${controlOrigin}/private`, { headers: { cookie: `identity=${identity}` } });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.match(response.headers.get("set-cookie") ?? "", /^control=private; HttpOnly; Secure; SameSite=Lax$/);
        const body: unknown = await response.json();
        assert.ok(typeof body === "object" && body !== null && "private" in body);
        assert.equal(body.private, `identity=${identity}`);
      }
    });

    await context.test("nonce controls use a fresh nonce in the document and policy", async () => {
      let previousNonce: string | undefined;
      for (let index = 0; index < 2; index++) {
        const response = await fetch(`${controlOrigin}/nonce`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        const policy = response.headers.get("content-security-policy") ?? "";
        const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
        assert.ok(nonce);
        assert.notEqual(nonce, previousNonce);
        const body = await response.text();
        assert.ok(body.includes(`nonce="${nonce}"`));
        previousNonce = nonce;
      }
    });

    await context.test("invalid methods and paths do not read the source", async () => {
      const before = reads;
      const cases: [string, string, number][] = [
        ["/public/one", "POST", 405],
        ["/public/INVALID", "GET", 400],
        ["/public/one?unknown=value", "GET", 400],
        ["/public/one?edition=a&edition=b", "GET", 400],
      ];
      for (const [path, method, status] of cases) {
        const response = await fetch(`${documentOrigin}${path}`, { method });
        assert.equal(response.status, Number(status));
        assert.equal(response.headers.get("cache-control"), "no-store");
        await response.text();
      }
      assert.equal(reads, before);
    });
  } finally {
    await Promise.all(servers.filter((server) => server.listening).map(close));
    if (originalHost === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = originalHost;
    if (originalProductionHost === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    else process.env.VERCEL_PROJECT_PRODUCTION_URL = originalProductionHost;
  }
});
