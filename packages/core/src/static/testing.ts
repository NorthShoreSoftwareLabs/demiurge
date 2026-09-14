import { readdir, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  generateStaticOutput,
  type GenerateStaticOutputOptions,
  type StaticOutputEntry,
  type StaticOutputManifest,
} from "./index";

const manifestFile = "demiurge-static-manifest.json";

export type StaticOutputTest = {
  outDir: string;
  manifest: StaticOutputManifest;
  entry(pathname: string): StaticOutputEntry | undefined;
  readFile(file: string): Promise<Uint8Array>;
  files(): Promise<string[]>;
  headers(pathname: string): Record<string, string> | undefined;
};

/**
 * Builds a static application and returns a manifest-backed inspection boundary.
 * The caller owns `outDir` and decides when to remove it.
 */
export async function createStaticOutputTest(
  options: GenerateStaticOutputOptions,
): Promise<StaticOutputTest> {
  const outDir = resolve(options.outDir);
  const manifest = await generateStaticOutput({ ...options, outDir });
  return inspectStaticOutput(outDir, manifest);
}

/** Reads the generated static manifest and returns a filesystem inspection boundary. */
export async function inspectStaticOutput(
  outDir: string,
  manifest?: StaticOutputManifest,
): Promise<StaticOutputTest> {
  const root = resolve(outDir);
  const outputManifest = manifest ?? await readStaticOutputManifest(root);
  const entries = new Map(outputManifest.entries.map((entry) => [entry.pathname, entry]));

  return {
    outDir: root,
    manifest: outputManifest,
    entry(pathname) {
      return entries.get(pathname);
    },
    async readFile(file) {
      return await readContainedFile(root, file);
    },
    async files() {
      return await listFiles(root);
    },
    headers(pathname) {
      return entries.get(pathname)?.headers;
    },
  };
}

/** Reads the static manifest from an output directory. */
export async function readStaticOutputManifest(
  outDir: string,
): Promise<StaticOutputManifest> {
  // TYPE-EVIDENCE: the static generator writes this JSON using StaticOutputManifest.
  return JSON.parse(await readFile(join(resolve(outDir), manifestFile), "utf8")) as StaticOutputManifest;
}

/**
 * Verifies that every manifest entry has its declared file and that no declared
 * file escapes the output directory. It returns the inspected manifest.
 */
export async function verifyStaticOutput(
  outDir: string,
  manifest?: StaticOutputManifest,
): Promise<StaticOutputManifest> {
  const output = await inspectStaticOutput(outDir, manifest);
  const files = new Set(await output.files());
  const declaredFiles = [
    ...output.manifest.entries.map((entry) => entry.file),
    ...(output.manifest.fontFiles ?? []),
    ...(output.manifest.imageFiles ?? []),
  ];
  for (const file of declaredFiles) {
    if (!files.has(file)) {
      throw new Error(`Static output is missing the declared file ${JSON.stringify(file)}.`);
    }
    await output.readFile(file);
  }
  return output.manifest;
}

/** Verifies a provider translator against the generated static manifest. */
export async function verifyStaticProvider<T>(
  manifest: StaticOutputManifest,
  translate: (manifest: StaticOutputManifest) => T | Promise<T>,
  verify: (translated: T, manifest: StaticOutputManifest) => void | Promise<void>,
): Promise<T> {
  const translated = await translate(manifest);
  await verify(translated, manifest);
  return translated;
}

async function readContainedFile(root: string, file: string) {
  if (!isContained(root, file)) {
    throw new Error(`Static output file is outside the output directory: ${JSON.stringify(file)}.`);
  }
  const realRoot = await realpath(root);
  const realFile = await realpath(join(root, file));
  const fromRoot = relative(realRoot, realFile);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
    throw new Error(`Static output file is outside the output directory: ${JSON.stringify(file)}.`);
  }
  return await readFile(realFile);
}

async function listFiles(root: string, directory = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, path));
    else if (entry.isFile()) files.push(relative(root, path).split(sep).join("/"));
  }
  return files.sort();
}

function isContained(root: string, file: string) {
  if (!file || file.startsWith("/") || file.startsWith("\\")) return false;
  const resolved = resolve(root, file);
  const fromRoot = relative(root, resolved);
  return fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`);
}
