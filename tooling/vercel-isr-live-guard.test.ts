import assert from "node:assert/strict";
import { test } from "node:test";
import guard from "./vercel-isr-live-guard";

void test("The guard rejects ineligible requests before and after valid requests.", () => {
  const cases: Array<[string, RequestInit]> = [
    ["", { method: "POST" }],
    ["", { headers: { cookie: "session=private" } }],
    ["", { headers: { authorization: "Bearer private" } }],
    ["", { headers: { "x-demiurge-navigation": "invalid" } }],
    ["", { headers: { "x-demiurge-navigation": "" } }],
    ["?preview=private", {}],
    ["?edition=a&edition=b", {}],
    ["?edition=a&edition=a", {}],
    ["?%65dition=a&edition=b", {}],
    ["?__proof_representation=navigation", {}],
  ];
  for (const path of ["/public/one", "/public/two"]) {
    for (const [query, init] of cases) {
      for (const warmed of [false, true]) {
        if (warmed) assert.equal(guard(new Request(`https://proof.invalid${path}`)).status, 200);
        const response = guard(new Request(`https://proof.invalid${path}${query}`, init));
        assert.equal(response.status, 400, `${path}${query}, warmed=${warmed}`);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("x-middleware-next"), null);
        assert.ok(response.headers.get("x-proof-guard"));
      }
    }
  }
});

void test("The guard passes valid public requests with a fresh invocation marker.", () => {
  const markers = new Set<string | null>();
  const variants: HeadersInit[] = [{}, { "x-demiurge-navigation": "data" }];
  for (const path of ["/public/one", "/public/two?edition=a", "/public/one?edition="]) {
    for (const method of ["GET", "HEAD"]) {
      for (const headers of variants) {
        const response = guard(new Request(`https://proof.invalid${path}`, { method, headers }));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("x-middleware-next"), "1");
        markers.add(response.headers.get("x-proof-guard"));
      }
    }
  }
  assert.equal(markers.size, 12);
  assert.ok(!markers.has(null));
});

void test("The guard leaves control and rejection paths to existing routes.", () => {
  for (const path of ["/raw-nav", "/private", "/nonce", "/proof-doc-one", "/public/three"]) {
    const response = guard(new Request(`https://proof.invalid${path}?unknown=value`, {
      method: "POST", headers: { cookie: "control=private" },
    }));
    assert.equal(response.headers.get("x-middleware-next"), "1");
  }
});
