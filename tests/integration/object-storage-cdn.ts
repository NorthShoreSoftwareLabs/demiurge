import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { startBucketServer } from "../../examples/object-storage-cdn/deploy/bucket-server";
import { startCdnServer } from "../../examples/object-storage-cdn/deploy/cdn-server";
import { publish, rollback, type DeployTarget } from "../../examples/object-storage-cdn/deploy/deploy";

const exampleRoot = resolve("examples/object-storage-cdn");
const outDir = resolve(exampleRoot, "dist");

const bucket = await startBucketServer({
  readSecret: "cdn-read-secret",
  writeSecret: "deploy-write-secret",
});
const cdn = await startCdnServer({
  adminSecret: "cdn-admin-secret",
  bucketOrigin: bucket.origin,
  bucketReadSecret: "cdn-read-secret",
});
const target: DeployTarget = {
  adminSecret: "cdn-admin-secret",
  bucketOrigin: bucket.origin,
  cdnOrigin: cdn.origin,
  readSecret: "cdn-read-secret",
  writeSecret: "deploy-write-secret",
};

try {
  // --- Security boundary: the bucket refuses listing and refuses a write
  // with only the CDN's read-only secret, regardless of path.
  const listing = await fetch(`${bucket.origin}/`);
  assert(listing.status === 403, `Directory listing should be refused, got ${listing.status}.`);

  const unauthorizedWrite = await fetch(`${bucket.origin}/objects/index.html`, {
    body: "attacker content",
    headers: { "x-bucket-secret": "cdn-read-secret" },
    method: "PUT",
  });
  assert(
    unauthorizedWrite.status === 403,
    `A write with only the read secret should be refused, got ${unauthorizedWrite.status}.`,
  );

  // --- First release.
  buildExample("Welcome to Demiurge.");
  const uploadOrder = await instrumentedPublish(target);

  const manifest = JSON.parse(
    await readFile(resolve(outDir, "demiurge-static-manifest.json"), "utf8"),
  ) as { entries: { file: string; pathname: string }[] };
  const pageKeys = new Set(manifest.entries.map((entry) => entry.file));
  const assetKeys = uploadOrder.filter((key) => !pageKeys.has(key) && key !== ".demiurge/manifest.json");
  const lastAssetIndex = Math.max(...assetKeys.map((key) => uploadOrder.indexOf(key)), -1);
  const firstPageIndex = Math.min(
    ...[...pageKeys].map((key) => uploadOrder.indexOf(key)).filter((index) => index >= 0),
  );

  assert(assetKeys.length > 0, "The build should produce at least one content-addressed asset.");
  assert(
    lastAssetIndex < firstPageIndex,
    `Every content-addressed asset must upload before any page. Assets ended at index ${lastAssetIndex}, pages started at ${firstPageIndex}.`,
  );

  // --- Metadata: the CDN response carries the manifest's own headers.
  const home = await fetch(`${cdn.origin}/`);
  assert(home.status === 200, `The home page should return 200, got ${home.status}.`);
  const homeCacheControl = home.headers.get("cache-control") ?? "";
  assert(
    homeCacheControl.includes("must-revalidate"),
    `A page's cache-control should be revalidated, got ${JSON.stringify(homeCacheControl)}.`,
  );
  const html = await home.text();
  assert(
    html.includes("Welcome to Demiurge."),
    "The first release's page content should be served.",
  );

  const assetPath = extractAssetPath(html);
  const asset = await fetch(`${cdn.origin}${assetPath}`);
  const assetCacheControl = asset.headers.get("cache-control") ?? "";
  assert(
    assetCacheControl.includes("immutable"),
    `A content-addressed asset's cache-control should be immutable, got ${JSON.stringify(assetCacheControl)}.`,
  );

  // --- Republish: a rebuild with new content only reaches clients after the
  // deploy invalidates the CDN's cached copy of the page.
  const cachedBeforeInvalidate = await fetch(`${cdn.origin}/`);
  assert(
    cachedBeforeInvalidate.headers.get("x-cdn-cache") === "HIT",
    "The home page should be served from the CDN's cache before a redeploy.",
  );

  buildExample("Cache invalidation reached the edge.");
  await publish(outDir, target);

  const republished = await fetch(`${cdn.origin}/`);
  assert(
    republished.headers.get("x-cdn-cache") === "MISS",
    "The CDN must have invalidated its cached copy of the page after a redeploy.",
  );
  const republishedHtml = await republished.text();
  assert(
    republishedHtml.includes("Cache invalidation reached the edge."),
    "The redeployed page's new content should be served.",
  );

  // --- Rollback: restores the previous release and invalidates the CDN.
  await rollback(target);
  const rolledBack = await fetch(`${cdn.origin}/`);
  assert(
    rolledBack.headers.get("x-cdn-cache") === "MISS",
    "The CDN must serve a fresh copy immediately after a rollback.",
  );
  const rolledBackHtml = await rolledBack.text();
  assert(
    rolledBackHtml.includes("Welcome to Demiurge."),
    "A rollback should restore the previous release's content.",
  );

  console.log("object-storage-cdn probe passed");
} finally {
  await cdn.stop();
  await bucket.stop();
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function extractAssetPath(html: string) {
  const match = /(?:src|href)="(\/assets\/[^"]+)"/.exec(html);
  if (!match) {
    throw new Error("The rendered page did not reference a hashed asset.");
  }
  return match[1]!;
}

function buildExample(releaseMessage: string) {
  const result = spawnSync("pnpm", ["build"], {
    cwd: exampleRoot,
    env: { ...process.env, RELEASE_MESSAGE: releaseMessage },
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`pnpm build in examples/object-storage-cdn exited with code ${result.status}.`);
  }
}

// Records the order the deploy pipeline uploads object keys in, by
// intercepting the same PUT requests `publish` issues, without changing the
// production `publish` function itself.
async function instrumentedPublish(deployTarget: DeployTarget) {
  const uploadOrder: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT" && typeof input === "string" && input.includes("/objects/")) {
      const key = decodeURIComponent(input.split("/objects/")[1]!);
      uploadOrder.push(key);
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    await publish(outDir, deployTarget);
  } finally {
    globalThis.fetch = originalFetch;
  }

  return uploadOrder;
}
