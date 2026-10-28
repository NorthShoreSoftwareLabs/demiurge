import assert from "node:assert/strict";
import { test } from "node:test";
import { assessRollback } from "./vercel-isr-live-rollback-assessment";

type Row = Record<string, unknown>;

function evidence(): Row[] {
  const original = ["rollback-original", "rollback-original-navigation", "rollback-original-hit", "rollback-restored", "rollback-restored-navigation"];
  const replacement = ["rollback-forward", "rollback-forward-navigation", "rollback-forward-hit", "rollback-inflight-generation", "rollback-replacement-retained"];
  const time = (seconds: number) => `2026-10-27T00:00:${String(seconds).padStart(2, "0")}.000Z`;
  const rows: Row[] = [...original, ...replacement].map((name) => {
    const navigation = name.endsWith("-navigation");
    const version = original.includes(name) ? 8 : ["rollback-inflight-generation", "rollback-replacement-retained"].includes(name) ? 10 : 9;
    const inflight = name === "rollback-inflight-generation";
    const restored = name.startsWith("rollback-restored");
    return {
      name, path: "/public/two", status: 200, release: original.includes(name) ? "original" : "replacement", version,
      cache: inflight ? "REVALIDATED" : "HIT", wrapper: navigation ? "navigation" : "document", navigationMarker: navigation ? "data" : null,
      contentType: navigation ? "application/json" : "text/html; charset=utf-8", bodyKind: navigation ? "json" : "html",
      generation: `${version}-${navigation}`, bodySha256: `digest-${version}-${navigation}`, hostileReflection: false, setCookiePresent: false,
      startedAt: time(inflight ? 10 : restored ? 24 : 0), finishedAt: time(inflight ? 23 : restored ? 25 : 1),
    };
  });
  rows.push(
    { name: "rollback-deployments", original: "https://original.vercel.app", replacement: "https://replacement.vercel.app", alias: "demiurge-isr-rollback-123.vercel.app", productionChanged: false, explicitDeploymentNamespace: true },
    { name: "rollback-generation-started", version: 10, sourceStartedAt: time(11), observedAt: time(12) },
    { name: "rollback-alias-restored", completedAt: time(15) },
    { name: "rollback-scope", aliasRestored: true, originalVersion: 8, restoredVersion: 8, replacementVersion: 10, globalPropagationVerified: false, atomicPublicationVerified: false },
    { name: "rollback-alias-cleanup", removed: true },
    { name: "rollback-replacement-cleanup", removed: true },
  );
  return rows;
}

void test("A completed rollback observation passes the bounded assessment.", () => {
  assert.deepEqual(assessRollback(evidence()), []);
});

void test("Missing and duplicate rollback observations fail closed.", () => {
  for (const row of evidence()) {
    assert.ok(assessRollback(evidence().filter((candidate) => candidate.name !== row.name)).length > 0, String(row.name));
    assert.ok(assessRollback([...evidence(), row]).some((failure) => failure.includes("exactly one")), String(row.name));
  }
});

void test("Late generation, false restoration, cache collisions, and cleanup failures cannot pass.", () => {
  const mutations: Array<[string, string, unknown]> = [
    ["rollback-deployments", "replacement", "https://original.vercel.app"],
    ["rollback-deployments", "replacement", "https://secret@replacement.vercel.app"],
    ["rollback-deployments", "original", "https://original.vercel.app/other"],
    ["rollback-deployments", "productionChanged", true],
    ["rollback-deployments", "alias", "production.vercel.app"],
    ["rollback-original-hit", "cache", "MISS"],
    ["rollback-forward-hit", "generation", "other-generation"],
    ["rollback-forward-navigation", "bodyKind", "html"],
    ["rollback-restored", "release", "replacement"],
    ["rollback-restored-navigation", "release", "replacement"],
    ["rollback-generation-started", "sourceStartedAt", "2026-10-27T00:00:16Z"],
    ["rollback-generation-started", "observedAt", "2026-10-27T00:00:24Z"],
    ["rollback-alias-restored", "completedAt", "2026-10-27T00:00:24Z"],
    ["rollback-inflight-generation", "finishedAt", "2026-10-27T00:00:14Z"],
    ["rollback-inflight-generation", "version", 9],
    ["rollback-inflight-generation", "release", "original"],
    ["rollback-inflight-generation", "cache", "HIT"],
    ["rollback-restored", "startedAt", "2026-10-27T00:00:22Z"],
    ["rollback-replacement-retained", "version", 9],
    ["rollback-scope", "globalPropagationVerified", true],
    ["rollback-scope", "atomicPublicationVerified", true],
    ["rollback-scope", "restoredVersion", 9],
    ["rollback-alias-cleanup", "removed", false],
    ["rollback-replacement-cleanup", "removed", false],
  ];
  for (const [name, key, value] of mutations) {
    const rows = evidence();
    rows.find((row) => row.name === name)![key] = value;
    assert.ok(assessRollback(rows).length > 0, `${name}.${key}`);
  }
});

void test("Fresh original data after rollback does not imply replacement artifact publication.", () => {
  const rows = evidence();
  rows.find((row) => row.name === "rollback-restored")!.version = 10;
  rows.find((row) => row.name === "rollback-restored-navigation")!.version = 10;
  rows.find((row) => row.name === "rollback-scope")!.restoredVersion = 10;
  assert.deepEqual(assessRollback(rows), []);
});
