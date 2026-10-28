type Row = Record<string, unknown>;

export function assessRollback(rows: readonly Row[]): string[] {
  const failures: string[] = [];
  const named = (name: string): Row => {
    const matches = rows.filter((row) => row.name === name);
    if (matches.length !== 1) failures.push(`${name}: expected exactly one observation.`);
    return matches[0] ?? {};
  };
  const check = (name: string, row: Row, key: string, expected: unknown) => {
    if (row[key] !== expected) failures.push(`${name}: expected ${key}=${String(expected)}.`);
  };
  const timestamp = (name: string, row: Row, key: string): number => {
    const value = typeof row[key] === "string" ? Date.parse(row[key]) : NaN;
    if (!Number.isFinite(value)) failures.push(`${name}: missing valid ${key}.`);
    return value;
  };
  const deployment = (row: Row, key: string): string | undefined => {
    try {
      const value = row[key];
      if (typeof value !== "string") throw new Error();
      const url = new URL(value);
      if (url.protocol !== "https:" || !url.hostname.endsWith(".vercel.app") || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) throw new Error();
      return url.hostname;
    } catch {
      failures.push(`rollback-deployments: invalid ${key} deployment.`);
      return undefined;
    }
  };
  const deployed = named("rollback-deployments");
  const originalHost = deployment(deployed, "original");
  const replacementHost = deployment(deployed, "replacement");
  if (originalHost === replacementHost) failures.push("rollback-deployments: deployment identities must differ.");
  if (typeof deployed.alias !== "string" || !/^demiurge-isr-rollback-\d+\.vercel\.app$/.test(deployed.alias)) failures.push("rollback-deployments: invalid temporary alias.");
  check("rollback-deployments", deployed, "productionChanged", false);

  const originalNames = ["rollback-original", "rollback-original-navigation", "rollback-original-hit", "rollback-restored", "rollback-restored-navigation"];
  const replacementNames = ["rollback-forward", "rollback-forward-navigation", "rollback-forward-hit", "rollback-inflight-generation", "rollback-replacement-retained"];
  for (const [names, release] of [[originalNames, "original"], [replacementNames, "replacement"]] as const) {
    for (const name of names) {
      const row = named(name);
      const navigation = name.endsWith("-navigation");
      check(name, row, "status", 200);
      check(name, row, "release", release);
      check(name, row, "bodyKind", navigation ? "json" : "html");
      check(name, row, "contentType", navigation ? "application/json" : "text/html; charset=utf-8");
      check(name, row, "wrapper", navigation ? "navigation" : "document");
      check(name, row, "navigationMarker", navigation ? "data" : null);
      check(name, row, "path", "/public/two");
      check(name, row, "hostileReflection", false);
      check(name, row, "setCookiePresent", false);
      if (!Number.isSafeInteger(row.version)) failures.push(`${name}: missing integer body version.`);
      for (const key of ["generation", "bodySha256"]) {
        if (typeof row[key] !== "string" || row[key].length === 0) failures.push(`${name}: missing ${key}.`);
      }
      const started = timestamp(name, row, "startedAt");
      const finished = timestamp(name, row, "finishedAt");
      if (finished < started) failures.push(`${name}: completion precedes request start.`);
    }
  }
  for (const name of ["rollback-original-hit", "rollback-forward-hit"]) check(name, named(name), "cache", "HIT");
  for (const name of ["rollback-forward", "rollback-forward-navigation", "rollback-forward-hit"]) check(name, named(name), "version", 9);
  for (const key of ["generation", "bodySha256"]) {
    if (named("rollback-forward")[key] !== named("rollback-forward-hit")[key]) failures.push(`rollback-forward-hit: changed ${key}.`);
  }
  const inflight = named("rollback-inflight-generation");
  check("rollback-inflight-generation", inflight, "version", 10);
  check("rollback-inflight-generation", inflight, "cache", "REVALIDATED");
  check("rollback-replacement-retained", named("rollback-replacement-retained"), "version", 10);

  const started = named("rollback-generation-started");
  check("rollback-generation-started", started, "version", 10);
  const requestStarted = timestamp("rollback-inflight-generation", inflight, "startedAt");
  const sourceStarted = timestamp("rollback-generation-started", started, "sourceStartedAt");
  const observed = timestamp("rollback-generation-started", started, "observedAt");
  const switched = timestamp("rollback-alias-restored", named("rollback-alias-restored"), "completedAt");
  const completed = timestamp("rollback-inflight-generation", inflight, "finishedAt");
  if (!(requestStarted <= sourceStarted && sourceStarted <= observed && observed <= switched && switched < completed)) {
    failures.push("rollback-inflight-generation: evidence does not place generation across the completed alias change.");
  }
  for (const name of ["rollback-restored", "rollback-restored-navigation"]) {
    if (timestamp(name, named(name), "startedAt") < completed) failures.push(`${name}: request precedes generation completion.`);
  }
  const scope = named("rollback-scope");
  check("rollback-scope", scope, "aliasRestored", true);
  check("rollback-scope", scope, "globalPropagationVerified", false);
  check("rollback-scope", scope, "atomicPublicationVerified", false);
  for (const [key, name] of [["originalVersion", "rollback-original"], ["restoredVersion", "rollback-restored"], ["replacementVersion", "rollback-replacement-retained"]]) {
    check("rollback-scope", scope, key, named(name).version);
  }
  for (const name of ["rollback-alias-cleanup", "rollback-replacement-cleanup"]) check(name, named(name), "removed", true);
  return failures;
}
