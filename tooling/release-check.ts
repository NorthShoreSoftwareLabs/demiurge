import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Validates the release metadata that a signed tag publishes. The release
// workflow runs this check after verification and before npm publication. A
// maintainer runs the same command locally before the tag exists.

export const expectedPackageName = "@demiurgejs/core";
export const expectedRepositorySlug = "NorthShoreSoftwareLabs/demiurge";
export const expectedPackageDirectory = "packages/core";

export type ReleaseCheckInput = {
  changedTrackedFiles: readonly string[];
  changelog: string;
  packageManifest: unknown;
  tag: string;
};

type ManifestRepository = {
  directory?: unknown;
  url?: unknown;
};

type PackageManifest = {
  name?: unknown;
  repository?: ManifestRepository | string;
  version?: unknown;
  dependencies?: unknown;
};

export function checkRelease(input: ReleaseCheckInput): string[] {
  const failures: string[] = [];
  const manifest = asManifest(input.packageManifest);

  if (manifest === undefined) {
    failures.push("packages/core/package.json is not a JSON object. Repair the manifest.");
    return failures;
  }

  const name = typeof manifest.name === "string" ? manifest.name : "";
  const version = typeof manifest.version === "string" ? manifest.version : "";

  failures.push(...checkTag(input.tag, version));
  failures.push(...checkName(name));
  failures.push(...checkRepository(manifest.repository));

  if (version !== "") {
    failures.push(...checkChangelog(input.changelog, version));
  }

  failures.push(...checkWorkingTree(input.changedTrackedFiles));
  return failures;
}

function checkTag(tag: string, version: string): string[] {
  if (version === "") {
    return ["packages/core/package.json does not declare a version. Set the release version."];
  }

  if (tag === "") {
    return ["No tag was supplied. Run the command with the release tag, for example v" + version + "."];
  }

  if (tag === `v${version}`) {
    return [];
  }

  return [
    `The tag ${tag} does not match the package version ${version}. ` +
      `Use the tag v${version}, or set packages/core/package.json to the tagged version.`,
  ];
}

function checkName(name: string): string[] {
  if (name === expectedPackageName) {
    return [];
  }

  return [
    `packages/core/package.json declares the package name ${name || "(none)"}. ` +
      `Set the name to ${expectedPackageName}.`,
  ];
}

function checkRepository(repository: ManifestRepository | string | undefined): string[] {
  const failures: string[] = [];
  const url = typeof repository === "string" ? repository : asText(repository?.url);
  const directory = typeof repository === "string" ? "" : asText(repository?.directory);

  if (!url.includes(expectedRepositorySlug)) {
    failures.push(
      `packages/core/package.json repository metadata does not identify ${expectedRepositorySlug}. ` +
        `Found ${url || "(none)"}.`,
    );
  }

  if (directory !== expectedPackageDirectory) {
    failures.push(
      `packages/core/package.json repository.directory must be ${expectedPackageDirectory}. ` +
        `Found ${directory || "(none)"}.`,
    );
  }

  return failures;
}

// The changelog groups a release line under one heading. A prerelease keeps
// the `Unreleased` marker on that line. The release process replaces the
// marker with a date at the stable release.
function checkChangelog(changelog: string, version: string): string[] {
  const releaseLine = version.split("-")[0];
  const prerelease = releaseLine !== version;
  const exactHeading = findHeading(changelog, version);
  const heading = exactHeading ?? (prerelease ? findHeading(changelog, releaseLine) : undefined);

  if (heading === undefined) {
    const wanted = prerelease ? `${version} or ${releaseLine}` : version;
    return [
      `CHANGELOG.md has no heading for version ${wanted}. ` +
        `Add a heading in the form "## ${version} — <date>".`,
    ];
  }

  if (!prerelease && /unreleased/iu.test(heading.remainder)) {
    return [
      `CHANGELOG.md still marks version ${version} as Unreleased. ` +
        "Replace the Unreleased marker with the release date.",
    ];
  }

  return [];
}

function checkWorkingTree(changedTrackedFiles: readonly string[]): string[] {
  if (changedTrackedFiles.length === 0) {
    return [];
  }

  return [
    "The tracked working tree changed during release verification: " +
      `${changedTrackedFiles.join(", ")}. Commit or revert these files, then tag the clean commit.`,
  ];
}

function checkTemplateVersion(coreVersion: string, templateManifest: unknown): string[] {
  const template = asManifest(templateManifest);

  if (template === undefined) {
    return ["packages/create-demiurge/templates/shared/package.json is not a JSON object. Repair the manifest."];
  }

  const templateCoreVersion =
    typeof template.dependencies === "object" && template.dependencies !== null
      ? // TYPE-EVIDENCE: The guard confirmed template.dependencies is a non-null object.
        (template.dependencies as Record<string, unknown>)["@demiurgejs/core"]
      : undefined;

  const templateVersionString = typeof templateCoreVersion === "string" ? templateCoreVersion : "";

  if (templateVersionString === "") {
    return [
      "packages/create-demiurge/templates/shared/package.json does not declare @demiurgejs/core. " +
        "Add or update the dependency.",
    ];
  }

  // Extract the base version from the range. For example, "^0.2.0-beta.3" becomes "0.2.0-beta.3".
  const templateVersionMatch = /[\^~]?(.+)/.exec(templateVersionString);
  const templateBaseVersion = templateVersionMatch ? templateVersionMatch[1] : templateVersionString;

  if (templateBaseVersion !== coreVersion) {
    return [
      `packages/create-demiurge/templates/shared/package.json pins @demiurgejs/core to ${templateVersionString}, ` +
        `but the release version is ${coreVersion}. Update the pinned version to match.`,
    ];
  }

  return [];
}

function findHeading(changelog: string, version: string) {
  for (const line of changelog.split("\n")) {
    const match = /^##\s+(\S+)\s*(.*)$/u.exec(line.trim());

    if (match && match[1] === version) {
      return { remainder: match[2].trim(), version };
    }
  }

  return undefined;
}

function asManifest(value: unknown): PackageManifest | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  // TYPE-EVIDENCE: The guard confirmed the value is a non-null object that is not an array.
  return value as PackageManifest;
}

function asText(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function changedTrackedFiles(repositoryRoot: string): string[] {
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });

  return status
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .sort();
}

function main(argv: readonly string[]) {
  const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
  // pnpm forwards the argument separator to the script. Remove it, so that
  // `pnpm release:check -- v0.1.0` and `pnpm release:check v0.1.0` agree.
  const tag = argv.filter((value) => value !== "--")[0] ?? "";
  const manifestPath = new URL("../packages/core/package.json", import.meta.url);
  const changelogPath = new URL("../CHANGELOG.md", import.meta.url);
  const templatePath = new URL("../packages/create-demiurge/templates/shared/package.json", import.meta.url);
  const packageManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const failures = checkRelease({
    changedTrackedFiles: changedTrackedFiles(repositoryRoot),
    changelog: readFileSync(changelogPath, "utf8"),
    packageManifest,
    tag,
  });

  // Check template version consistency
  const coreVersion = typeof packageManifest.version === "string" ? packageManifest.version : "";
  if (coreVersion !== "") {
    const templateManifest = JSON.parse(readFileSync(templatePath, "utf8"));
    failures.push(...checkTemplateVersion(coreVersion, templateManifest));
  }

  if (failures.length === 0) {
    console.log(`Release metadata is consistent for ${tag}.`);
    return;
  }

  console.error("Release check failed:\n");

  for (const failure of failures) {
    console.error(`- ${failure}`);
  }

  console.error("\nUsage: pnpm release:check -- v0.1.0");
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
