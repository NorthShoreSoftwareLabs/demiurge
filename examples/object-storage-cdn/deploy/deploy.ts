// A provider-neutral deployment algorithm for a static build behind an
// object-storage origin and a CDN. It speaks to the origin only through
// `putObject` / `getObject` / `headObject` / `deleteObject` below. Pointing
// it at a real bucket API is a matter of replacing those four functions, not
// the algorithm.
//
// Stages, matching the deployment pipeline in
// `docs/guides/object-storage-cdn-deployment.md`:
//
// 1. Read the static manifest. Classify every output file as a
//    content-addressed asset or a mutable file: a page, `404.html`, or the
//    manifest object itself.
// 2. Back up the live bytes of every mutable file the previous release
//    published. A failed publish or a later rollback needs something
//    complete to restore.
// 3. Upload content-addressed assets first. Their names never repeat across
//    releases. A page that references one always finds it already on the
//    origin by the time a client can request the page.
// 4. Upload mutable files. A failure here restores every mutable file this
//    pass already overwrote, from the backup taken in stage 2. A partial
//    upload never becomes the active release.
// 5. Delete mutable files the new release no longer publishes. Assets are
//    never deleted this way. An old page can still reference one after its
//    own file drops out of the manifest, and content-addressed names make
//    that safe indefinitely.
// 6. Invalidate the CDN's cached copy of every mutable file. A fingerprinted
//    asset's name changed if its bytes changed, so it needs no invalidation.
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { StaticOutputManifest } from "@demiurgejs/core/static";
import { objectUrl } from "./object-url";

const MANIFEST_KEY = ".demiurge/manifest.json";
const PREVIOUS_MANIFEST_KEY = ".demiurge/previous-manifest.json";
const previousBackupKey = (key: string) => `.demiurge/previous/${key}`;

export type DeployTarget = {
  adminSecret: string;
  bucketOrigin: string;
  cdnOrigin: string;
  readSecret: string;
  writeSecret: string;
};

type OutputFile = {
  body?: Buffer;
  headers: Record<string, string>;
  key: string;
  mutable: boolean;
  path: string;
};

async function fileBody(file: OutputFile) {
  return file.body ?? await readFile(file.path);
}

export async function publish(outDir: string, target: DeployTarget) {
  // The CDN routes every request from this manifest object, so it must carry
  // the exact headers the CDN will serve. The build's own manifest leaves a
  // page's cache-control to the host. This fills in that default before the
  // manifest is what gets uploaded and read back.
  const manifest = withPageCacheDefaults(await readManifestFile(outDir));
  const files = await planOutputFiles(outDir, manifest);
  const manifestFile: OutputFile = {
    body: Buffer.from(JSON.stringify(manifest)),
    headers: { "content-type": "application/json" },
    key: MANIFEST_KEY,
    mutable: true,
    path: "",
  };
  const mutableFiles = [...files.filter((file) => file.mutable), manifestFile];
  const immutableFiles = files.filter((file) => !file.mutable);

  const previousManifestObject = await getObject(target, MANIFEST_KEY);
  // TYPE-EVIDENCE: this key only ever holds JSON this same deploy pipeline wrote from a StaticOutputManifest, in withPageCacheDefaults below.
  const previousManifest = previousManifestObject
    ? JSON.parse(previousManifestObject.body.toString("utf8")) as StaticOutputManifest
    : undefined;
  const previousMutableKeys = previousManifest
    ? new Set(previousManifest.entries.map((entry) => entry.file))
    : new Set<string>();
  previousMutableKeys.add(MANIFEST_KEY);

  // Stage 2: back up the previous release's mutable files before touching
  // anything live. This backup, not the new release, is what a rollback or a
  // failed publish restores.
  if (previousManifest) {
    for (const key of previousMutableKeys) {
      const object = await getObject(target, key);
      if (object) {
        await putObject(target, previousBackupKey(key), object.body, object.headers);
      }
    }
    await putObject(
      target,
      PREVIOUS_MANIFEST_KEY,
      Buffer.from(JSON.stringify(previousManifest)),
      { "content-type": "application/json" },
    );
  }

  // Stage 3: content-addressed assets are safe to upload at any point,
  // including before the mutable files that will reference them. Their name
  // only ever refers to one set of bytes. A HEAD skips an asset that a
  // previous, partially-failed publish already uploaded.
  for (const file of immutableFiles) {
    const existing = await headObject(target, file.key);
    if (existing) continue;
    await putObject(target, file.key, await fileBody(file), file.headers);
  }

  // Stage 4: mutable files publish last, and any failure here rolls back
  // every mutable file this pass already overwrote.
  const publishedMutableKeys: string[] = [];
  try {
    for (const file of mutableFiles) {
      await putObject(target, file.key, await fileBody(file), file.headers);
      publishedMutableKeys.push(file.key);
    }
  } catch (error) {
    await restoreFromBackup(target, publishedMutableKeys, previousManifest !== undefined);
    throw new Error(
      "Publish failed while uploading a mutable file. Every mutable file this " +
        "release had already published was restored from the previous release.",
      { cause: error },
    );
  }

  // Stage 5: an obsolete mutable file (a page the new release removed) is
  // deleted only now, after every new mutable file is confirmed live.
  const newMutableKeys = new Set(mutableFiles.map((file) => file.key));
  for (const key of previousMutableKeys) {
    if (key !== MANIFEST_KEY && !newMutableKeys.has(key)) {
      await deleteObject(target, key);
    }
  }

  // Stage 6: invalidate every mutable key the CDN may have cached under its
  // unchanged name, including the manifest object the CDN uses for routing.
  await invalidate(target, [...newMutableKeys]);

  return {
    immutableUploaded: immutableFiles.length,
    mutableUploaded: mutableFiles.length,
  };
}

export async function rollback(target: DeployTarget) {
  const previousManifestObject = await getObject(target, PREVIOUS_MANIFEST_KEY);
  if (!previousManifestObject) {
    throw new Error("There is no previous release to roll back to.");
  }

  // TYPE-EVIDENCE: this key only ever holds JSON this same deploy pipeline wrote from a StaticOutputManifest, in withPageCacheDefaults below.
  const previousManifest = JSON.parse(previousManifestObject.body.toString("utf8")) as StaticOutputManifest;
  const previousMutableKeys = new Set(previousManifest.entries.map((entry) => entry.file));
  previousMutableKeys.add(MANIFEST_KEY);

  const currentManifestObject = await getObject(target, MANIFEST_KEY);
  // TYPE-EVIDENCE: this key only ever holds JSON this same deploy pipeline wrote from a StaticOutputManifest, in withPageCacheDefaults below.
  const currentManifest = currentManifestObject
    ? JSON.parse(currentManifestObject.body.toString("utf8")) as StaticOutputManifest
    : undefined;
  const currentOnlyKeys = currentManifest
    ? currentManifest.entries.map((entry) => entry.file)
      .filter((key) => !previousMutableKeys.has(key))
    : [];

  await restoreFromBackup(target, [...previousMutableKeys], true);
  for (const key of currentOnlyKeys) {
    await deleteObject(target, key);
  }

  await invalidate(target, [...previousMutableKeys, ...currentOnlyKeys]);

  return { restored: previousMutableKeys.size };
}

async function restoreFromBackup(target: DeployTarget, keys: string[], backupExists: boolean) {
  for (const key of keys) {
    const backup = backupExists ? await getObject(target, previousBackupKey(key)) : undefined;
    if (backup) {
      await putObject(target, key, backup.body, backup.headers);
    } else {
      await deleteObject(target, key);
    }
  }
}

async function readManifestFile(outDir: string): Promise<StaticOutputManifest> {
  const raw = await readFile(join(outDir, "demiurge-static-manifest.json"), "utf8");
  // TYPE-EVIDENCE: this file is `generateStaticOutput`'s own manifest write, whose shape is StaticOutputManifest.
  return JSON.parse(raw) as StaticOutputManifest;
}

async function planOutputFiles(
  outDir: string,
  manifest: StaticOutputManifest,
): Promise<OutputFile[]> {
  const entryByFile = new Map(manifest.entries.map((entry) => [entry.file, entry]));
  const paths = await listFiles(outDir);

  return paths.flatMap((path) => {
    const key = relative(outDir, path).split(sep).join("/");
    if (key === "demiurge-static-manifest.json" || key === "demiurge-manifest.json") {
      return [];
    }

    const entry = entryByFile.get(key);
    return [{
      headers: entry ? entry.headers : headersForFile(manifest, key),
      key,
      mutable: Boolean(entry),
      path,
    }];
  });
}

// The manifest names a page's security and content-type headers, but leaves
// its cache-control to the host. This is the same way it leaves an asset's
// content-type to the host. A page's object key is mutable and gets
// invalidated on every deploy. Revalidating it on every request is the
// correct default absent an application-declared cache rule.
function withPageCacheDefaults(manifest: StaticOutputManifest): StaticOutputManifest {
  return {
    ...manifest,
    entries: manifest.entries.map((entry) => entry.headers["cache-control"]
      ? entry
      : {
        ...entry,
        headers: { ...entry.headers, "cache-control": "public, max-age=0, must-revalidate" },
      }),
  };
}

// The manifest's file header rules cover cache and security headers for
// every file the framework did not list as a route entry. They leave
// content type to the host. A platform like Vercel infers it from the file
// extension on its own. A plain object-storage bucket does not. The
// deployment sets it explicitly from the same extension table any static
// file server uses.
const CONTENT_TYPES_BY_EXTENSION: Record<string, string> = {
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
  webmanifest: "application/manifest+json",
  woff2: "font/woff2",
  xml: "application/xml; charset=utf-8",
};

function headersForFile(manifest: StaticOutputManifest, key: string): Record<string, string> {
  const basename = key.split("/").pop() ?? key;
  const rule = manifest.fileHeaderRules.find((candidate) => new RegExp(candidate.pattern).test(basename));
  const headers = rule ? { ...rule.headers } : {};

  if (!headers["content-type"]) {
    const extension = basename.split(".").pop() ?? "";
    const contentType = CONTENT_TYPES_BY_EXTENSION[extension];
    if (contentType) headers["content-type"] = contentType;
  }

  return headers;
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(path);
    return [path];
  }));
  return files.flat();
}

async function putObject(target: DeployTarget, key: string, body: Buffer, headers: Record<string, string>) {
  const response = await fetch(objectUrl(target.bucketOrigin, key), {
    // Node's fetch accepts a Buffer as a body at runtime, but its BodyInit
    // type does not include one. A Uint8Array view of the same bytes does.
    body: new Uint8Array(body),
    headers: {
      "x-bucket-secret": target.writeSecret,
      ...(headers["content-type"] ? { "x-meta-content-type": headers["content-type"] } : {}),
      ...(headers["cache-control"] ? { "x-meta-cache-control": headers["cache-control"] } : {}),
    },
    method: "PUT",
  });

  if (!response.ok) {
    throw new Error(`Uploading ${JSON.stringify(key)} failed with status ${response.status}.`);
  }
}

async function headObject(target: DeployTarget, key: string) {
  const response = await fetch(objectUrl(target.bucketOrigin, key), {
    headers: { "x-bucket-secret": target.readSecret },
    method: "HEAD",
  });
  return response.ok;
}

async function getObject(target: DeployTarget, key: string) {
  const response = await fetch(objectUrl(target.bucketOrigin, key), {
    headers: { "x-bucket-secret": target.readSecret },
  });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`Reading ${JSON.stringify(key)} failed with status ${response.status}.`);
  }

  const headers: Record<string, string> = {};
  const contentType = response.headers.get("content-type");
  const cacheControl = response.headers.get("cache-control");
  if (contentType) headers["content-type"] = contentType;
  if (cacheControl) headers["cache-control"] = cacheControl;

  return { body: Buffer.from(await response.arrayBuffer()), headers };
}

async function deleteObject(target: DeployTarget, key: string) {
  const response = await fetch(objectUrl(target.bucketOrigin, key), {
    headers: { "x-bucket-secret": target.writeSecret },
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Deleting ${JSON.stringify(key)} failed with status ${response.status}.`);
  }
}

async function invalidate(target: DeployTarget, keys: string[]) {
  const response = await fetch(`${target.cdnOrigin}/_cdn/invalidate`, {
    body: JSON.stringify({ keys }),
    headers: {
      "content-type": "application/json",
      "x-cdn-admin-secret": target.adminSecret,
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`CDN invalidation failed with status ${response.status}.`);
  }
}

async function main() {
  const [, , command] = process.argv;
  const outDir = resolve(process.env.OUT_DIR ?? "dist");
  const target: DeployTarget = {
    adminSecret: requireEnv("CDN_ADMIN_SECRET"),
    bucketOrigin: requireEnv("BUCKET_ORIGIN"),
    cdnOrigin: requireEnv("CDN_ORIGIN"),
    readSecret: requireEnv("BUCKET_READ_SECRET"),
    writeSecret: requireEnv("BUCKET_WRITE_SECRET"),
  };

  if (command === "rollback") {
    const result = await rollback(target);
    console.log(`Rolled back ${result.restored} mutable file(s).`);
    return;
  }

  const result = await publish(outDir, target);
  console.log(
    `Published ${result.immutableUploaded} asset(s) and ${result.mutableUploaded} mutable file(s).`,
  );
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set.`);
  }
  return value;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  await main();
}
