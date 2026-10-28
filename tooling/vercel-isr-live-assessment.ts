import { assessRollback } from "./vercel-isr-live-rollback-assessment";

type Row = Record<string, unknown>;

export function assessIsolated(rows: readonly Row[]): string[] {
  const failures: string[] = [];
  const named = (name: string): Row => {
    const matches = rows.filter((row) => row.name === name);
    if (matches.length !== 1) failures.push(`${name}: expected exactly one observation.`);
    return matches[0] ?? {};
  };
  const check = (name: string, row: Row, key: string, expected: unknown) => {
    if (row[key] !== expected) failures.push(`${name}: expected ${key}=${String(expected)}.`);
  };
  const present = (name: string, row: Row, key: string) => {
    if (typeof row[key] !== "string" || row[key].length === 0) failures.push(`${name}: missing ${key}.`);
  };
  const documents = ["cold-document", "repeat-document", "document-after-navigation", "second-path", "edition-a", "edition-b", "warm-before-security", "hostile-headers", "timed-stale", "timed-fresh", "explicit-revalidation", "explicit-revalidation-repeat", "explicit-document-result", "failed-regeneration-stale", "retry-trigger", "retry-result", "race-document-revalidation", "race-document-result", "public-after-bypass", "lost-acknowledgment-result", "lost-acknowledgment-observation", "lost-acknowledgment-retry"];
  const navigations = ["cold-navigation", "repeat-navigation", "cold-navigation-first", "repeat-navigation-first", "timed-navigation", "explicit-navigation-result", "race-navigation-revalidation", "race-navigation-result"];
  for (const [names, representation] of [[documents, "document"], [navigations, "navigation"]] as const) {
    for (const name of names) {
      const row = named(name);
      check(name, row, "status", 200);
      check(name, row, "contentType", representation === "document" ? "text/html; charset=utf-8" : "application/json");
      check(name, row, "bodyKind", representation === "document" ? "html" : "json");
      check(name, row, "wrapper", representation);
      check(name, row, "navigationMarker", representation === "document" ? null : "data");
      check(name, row, "hostileReflection", false);
      check(name, row, "setCookiePresent", false);
      present(name, row, "guard");
      present(name, row, "generation");
      present(name, row, "bodySha256");
      present(name, row, "runtime");
      if (!Number.isSafeInteger(row.version)) failures.push(`${name}: missing integer body version.`);
      if (typeof row.csp !== "string" || !/(?:^|;)\s*script-src\s/.test(row.csp) || row.csp.includes("nonce-")) failures.push(`${name}: missing static script CSP.`);
    }
  }
  const raw = named("raw-navigation");
  check("raw-navigation", raw, "status", 200);
  check("raw-navigation", raw, "contentType", "application/json");
  check("raw-navigation", raw, "bodyKind", "json");
  check("raw-navigation", raw, "navigationMarker", "data");
  for (const [first, repeat] of [["cold-document", "repeat-document"], ["cold-navigation", "repeat-navigation"], ["cold-navigation-first", "repeat-navigation-first"]]) {
    const initial = named(first);
    const hit = named(repeat);
    check(repeat, hit, "cache", "HIT");
    for (const key of ["generation", "bodySha256", "path", "csp", "middleware"]) {
      if (typeof initial[key] !== "string" || initial[key] !== hit[key]) failures.push(`${repeat}: changed or missing ${key}.`);
    }
    if (typeof initial.guard !== "string" || typeof hit.guard !== "string" || initial.guard === hit.guard) failures.push(`${repeat}: guard did not run again.`);
  }
  for (const name of ["document-after-navigation", "second-path", "cold-navigation-first", "repeat-navigation-first"]) check(name, named(name), "id", "two");
  for (const edition of ["a", "b"]) check(`edition-${edition}`, named(`edition-${edition}`), "edition", edition);
  for (const name of ["cold-cookie", "cold-authorization", "cold-unknown-query", "cold-duplicate-query", "unknown-query", "duplicate-query", "reserved-query", "encoded-unknown-query", "encoded-duplicate-query", "unknown-query-second-path", "duplicate-query-second-path", "cookie-hit", "authorization-hit", "invalid-navigation", "direct-document-function", "direct-navigation-function", "mutation", "invalid-bypass", "valid-bypass"]) check(name, named(name), "status", 400);
  for (const name of ["private-control", "private-control-repeat", "nonce-control", "nonce-control-repeat"]) {
    const row = named(name);
    check(name, row, "status", 200);
    if (typeof row.cacheControl !== "string" || !row.cacheControl.includes("private") || !row.cacheControl.includes("no-store")) failures.push(`${name}: missing private no-store policy.`);
    check(name, row, name.startsWith("private") ? "privateIdentityMatches" : "nonceMatchesBody", true);
    if (name.startsWith("private")) check(name, row, "setCookiePresent", true);
  }
  const nonce = named("nonce-control");
  const repeatNonce = named("nonce-control-repeat");
  if (typeof nonce.csp !== "string" || typeof repeatNonce.csp !== "string" || nonce.csp === repeatNonce.csp) failures.push("nonce-control-repeat: missing or repeated CSP nonce.");
  for (const [name, version] of [["timed-stale", 1], ["timed-fresh", 2], ["explicit-document-result", 3], ["explicit-navigation-result", 3], ["failed-regeneration-stale", 3], ["retry-result", 4], ["race-document-revalidation", 5], ["race-navigation-revalidation", 6], ["race-document-result", 5], ["race-navigation-result", 6]] as const) check(name, named(name), "version", version);
  for (const [name, cache] of [
    ["timed-stale", "STALE"], ["timed-navigation", "STALE"], ["timed-fresh", "HIT"],
    ["explicit-revalidation", "REVALIDATED"], ["explicit-revalidation-repeat", "REVALIDATED"],
    ["explicit-document-result", "HIT"], ["explicit-navigation-result", "HIT"],
    ["failed-revalidation", "REVALIDATED"], ["failed-regeneration-stale", "STALE"],
    ["retry-trigger", "STALE"], ["retry-result", "HIT"],
    ["race-document-revalidation", "REVALIDATED"], ["race-navigation-revalidation", "REVALIDATED"],
    ["race-document-result", "HIT"], ["race-navigation-result", "HIT"],
    ["lost-acknowledgment-retry", "REVALIDATED"], ["lost-acknowledgment-result", "HIT"],
  ]) check(name, named(name), "cache", cache);
  for (const [generation, publication] of [
    ["explicit-revalidation-repeat", "explicit-document-result"],
    ["explicit-document-result", "failed-regeneration-stale"],
    ["race-document-revalidation", "race-document-result"],
    ["race-navigation-revalidation", "race-navigation-result"],
    ["lost-acknowledgment-retry", "lost-acknowledgment-result"],
  ]) {
    const generated = named(generation);
    const published = named(publication);
    for (const key of ["generation", "bodySha256"]) {
      if (typeof generated[key] !== "string" || generated[key] !== published[key]) {
        failures.push(`${publication}: changed or missing ${key} from ${generation}.`);
      }
    }
  }
  check("failed-revalidation", named("failed-revalidation"), "status", 500);
  check("lost-acknowledgment", named("lost-acknowledgment"), "transportFailed", true);
  check("lost-acknowledgment", named("lost-acknowledgment"), "transportFailure", "curl-timeout-28");
  check("lost-acknowledgment", named("lost-acknowledgment"), "acknowledgment", "unknown");
  const origin = named("lost-acknowledgment-origin");
  check("lost-acknowledgment-origin", origin, "observed", true);
  const result = named("lost-acknowledgment-observation");
  const observedAt = typeof origin.observedAt === "string" ? Date.parse(origin.observedAt) : NaN;
  const requestedAt = typeof result.startedAt === "string" ? Date.parse(result.startedAt) : NaN;
  if (!Number.isFinite(observedAt) || !Number.isFinite(requestedAt) || observedAt > requestedAt) {
    failures.push("lost-acknowledgment-origin: origin evidence must precede the result request.");
  }
  if (result.version !== 5 && result.version !== 7) failures.push("lost-acknowledgment-observation: expected the previous or attempted version.");
  check("lost-acknowledgment-retry", named("lost-acknowledgment-retry"), "version", 7);
  check("lost-acknowledgment-result", named("lost-acknowledgment-result"), "version", 7);
  return [...new Set(failures)];
}

export function assessCompletion(rows: readonly Row[]): string[] {
  const failures = [...assessIsolated(rows), ...assessRollback(rows)];
  const eligibility = rows.filter((candidate) => candidate.name === "artifact-eligibility");
  if (eligibility.length !== 1) failures.push("artifact-eligibility: expected exactly one observation.");
  const artifact = eligibility[0] ?? {};
  const expectedTargets = ["proof-doc-one.prerender-config.json", "proof-doc-two.prerender-config.json", "proof-nav-one.prerender-config.json", "proof-nav-two.prerender-config.json"];
  if (JSON.stringify(artifact.prerenderTargets) !== JSON.stringify(expectedTargets)) failures.push("artifact-eligibility: unexpected prerender targets.");
  for (const property of ["privateControlExcluded", "nonceControlExcluded", "publicCredentialsAbsent", "runtimeResponseValidation"]) {
    if (artifact[property] !== true) failures.push(`artifact-eligibility: missing ${property}.`);
  }
  for (const property of ["arbitraryMiddlewareEligible", "headerVariantsEligible"]) {
    if (artifact[property] !== false) failures.push(`artifact-eligibility: unsupported ${property}.`);
  }
  for (const name of ["cold-document", "repeat-document", "cold-navigation", "repeat-navigation", "timed-fresh", "explicit-document-result", "explicit-navigation-result", "retry-result"]) {
    const row = rows.find((candidate) => candidate.name === name) ?? {};
    for (const contribution of ["layoutVersion", "metadataVersion", "documentVersion"]) {
      if (!Number.isSafeInteger(row[contribution]) || row[contribution] !== row.version) {
        failures.push(`${name}: ${contribution} does not match the fresh page version.`);
      }
    }
  }
  const browser = rows.filter((row) => row.name === "browser-hydration-navigation");
  if (browser.length !== 1) failures.push("browser-hydration-navigation: expected exactly one observation.");
  const row = browser[0] ?? {};
  for (const property of ["hydrated", "interaction", "history", "documentContributions"]) {
    if (row[property] !== true) failures.push(`browser-hydration-navigation: missing ${property}.`);
  }
  if (row.documentRequests !== 1 || typeof row.navigationRequests !== "number" || row.navigationRequests < 2 || typeof row.assetRequests !== "number" || row.assetRequests < 1) {
    failures.push("browser-hydration-navigation: missing document, asset, or navigation requests.");
  }
  if (!Array.isArray(row.errors) || row.errors.length !== 0) failures.push("browser-hydration-navigation: browser errors occurred.");
  return [...new Set(failures)];
}
