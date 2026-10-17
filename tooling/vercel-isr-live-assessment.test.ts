import assert from "node:assert/strict";
import { test } from "node:test";
import { assessIsolated } from "./vercel-isr-live-assessment";

function evidence(): Array<Record<string, unknown>> {
  const documents = ["cold-document", "repeat-document", "document-after-navigation", "second-path", "edition-a", "edition-b", "warm-before-security", "hostile-headers", "timed-stale", "timed-fresh", "explicit-revalidation", "explicit-revalidation-repeat", "explicit-document-result", "failed-regeneration-stale", "retry-trigger", "retry-result", "race-document-revalidation", "race-document-result", "public-after-bypass", "lost-acknowledgment-result", "lost-acknowledgment-observation", "lost-acknowledgment-retry"];
  const navigations = ["cold-navigation", "repeat-navigation", "cold-navigation-first", "repeat-navigation-first", "timed-navigation", "explicit-navigation-result", "race-navigation-revalidation", "race-navigation-result", "raw-navigation"];
  const rows: Array<Record<string, unknown>> = [...documents, ...navigations].map((name) => {
    const navigation = navigations.includes(name);
    const second = ["document-after-navigation", "second-path", "cold-navigation-first", "repeat-navigation-first"].includes(name);
    return { name, status: 200, contentType: navigation ? "application/json" : "text/html; charset=utf-8", bodyKind: navigation ? "json" : "html", wrapper: navigation ? "navigation" : "document", navigationMarker: navigation ? "data" : null, guard: name, generation: navigation ? "nav-generation" : "doc-generation", bodySha256: navigation ? "nav-digest" : "doc-digest", path: second ? "/public/two" : "/public/one", id: second ? "two" : "one", cache: "HIT", hostileReflection: false, setCookiePresent: false, runtime: "v22.13.0", csp: "script-src 'self'", middleware: "1", version: 1 };
  });
  for (const name of ["cold-cookie", "cold-authorization", "cold-unknown-query", "cold-duplicate-query", "unknown-query", "duplicate-query", "reserved-query", "encoded-unknown-query", "encoded-duplicate-query", "unknown-query-second-path", "duplicate-query-second-path", "cookie-hit", "authorization-hit", "invalid-navigation", "direct-document-function", "direct-navigation-function", "mutation", "invalid-bypass", "valid-bypass"]) rows.push({ name, status: 400 });
  for (const name of ["private-control", "private-control-repeat", "nonce-control", "nonce-control-repeat"]) rows.push({ name, status: 200, cacheControl: "private, no-store", privateIdentityMatches: true, nonceMatchesBody: true, setCookiePresent: true, csp: name });
  rows.push({ name: "failed-revalidation", status: 500 });
  rows.push({ name: "lost-acknowledgment", transportFailed: true, transportFailure: "curl-timeout-28", acknowledgment: "unknown" });
  rows.push({ name: "lost-acknowledgment-origin", observed: true, observedAt: "2026-10-17T00:00:00Z" });
  rows.find((row) => row.name === "lost-acknowledgment-result")!.version = 7;
  rows.find((row) => row.name === "lost-acknowledgment-retry")!.version = 7;
  Object.assign(rows.find((row) => row.name === "lost-acknowledgment-observation")!, { version: 5, startedAt: "2026-10-17T00:00:01Z" });
  for (const [name, version] of [["timed-fresh", 2], ["explicit-document-result", 3], ["explicit-navigation-result", 3], ["failed-regeneration-stale", 3], ["retry-result", 4], ["race-document-revalidation", 5], ["race-navigation-revalidation", 6], ["race-document-result", 5], ["race-navigation-result", 6]] as const) rows.find((row) => row.name === name)!.version = version;
  for (const edition of ["a", "b"]) rows.find((row) => row.name === `edition-${edition}`)!.edition = edition;
  return rows;
}

void test("Complete isolated observations pass the bounded assessment.", () => {
  assert.deepEqual(assessIsolated(evidence()), []);
});

void test("Missing and duplicate observations fail closed.", () => {
  assert.ok(assessIsolated([]).length > 30);
  for (const row of evidence()) {
    const name = row.name;
    assert.ok(assessIsolated(evidence().filter((candidate) => candidate.name !== name)).some((failure) => failure.startsWith(`${String(name)}:`)), String(name));
  }
  assert.ok(assessIsolated([...evidence(), evidence()[0]]).some((failure) => failure.includes("exactly one")));
});

void test("Cache collisions, skipped guards, stale versions, and false security evidence fail.", () => {
  const mutations: Array<[string, string, unknown]> = [
    ["repeat-navigation", "contentType", "text/html; charset=utf-8"],
    ["race-document-result", "bodyKind", "json"],
    ["repeat-document", "guard", "cold-document"],
    ["repeat-document", "middleware", "2"],
    ["repeat-document", "csp", "script-src https://changed.invalid"],
    ["cold-document", "runtime", null],
    ["cold-navigation", "version", null],
    ["cold-document", "csp", "script-src 'nonce-secret'"],
    ["lost-acknowledgment", "transportFailed", false],
    ["lost-acknowledgment", "transportFailure", "other-error"],
    ["lost-acknowledgment", "acknowledgment", "success"],
    ["lost-acknowledgment-origin", "observed", false],
    ["lost-acknowledgment-origin", "observedAt", "2026-10-18T00:00:00Z"],
    ["lost-acknowledgment-result", "version", 6],
    ["lost-acknowledgment-retry", "version", 5],
    ["lost-acknowledgment-observation", "version", 6],
    ["repeat-navigation", "generation", "changed"],
    ["repeat-document", "bodySha256", "changed"],
    ["repeat-navigation", "cache", "MISS"],
    ["unknown-query", "status", 200],
    ["explicit-navigation-result", "version", 2],
    ["race-document-result", "version", 6],
    ["nonce-control", "nonceMatchesBody", false],
    ["nonce-control-repeat", "csp", "nonce-control"],
    ["private-control-repeat", "privateIdentityMatches", false],
    ["private-control", "cacheControl", "public"],
    ["hostile-headers", "hostileReflection", true],
  ];
  for (const [name, key, value] of mutations) {
    const rows = evidence();
    rows.find((row) => row.name === name)![key] = value;
    assert.ok(assessIsolated(rows).some((failure) => failure.startsWith(`${name}:`)), `${name}.${key}`);
  }
});
