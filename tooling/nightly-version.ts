// Pure decision logic for the nightly channel. This module reads no files,
// runs no commands, and reaches no network. `tooling/nightly-release.ts`
// collects the real inputs and calls into here. The separation lets
// `tooling/nightly-version.test.ts` prove the rules that keep the stable
// version and the `latest` dist-tag out of reach.

export const NIGHTLY_DIST_TAG = "nightly";
export const CORE_PACKAGE_DIRECTORY = "./packages/core";

// A nightly version always carries a `nightly` prerelease identifier.
// npm never assigns `latest` to a prerelease version on its own.
// The identifier is the first of the two guards.
// The explicit `--tag nightly` argument is the second.
const NIGHTLY_VERSION_PATTERN = /^\d+\.\d+\.\d+-nightly\.(\d{8})\.([0-9a-f]{7,40})$/u;
const RELEASE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u;
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/u;

export type NightlyPlan = {
  publish: boolean;
  reason: string;
  version?: string;
};

export type NightlyPlanInput = {
  commit: string;
  date: Date;
  packageVersion: string;
  publishedNightlyVersion?: string;
};

export type PublishArgumentsInput = {
  directory?: string;
  dryRun?: boolean;
  tag: string;
  version: string;
};

// The nightly base version is the next version that `main` works toward.
// A prerelease package version means that version is not released yet, so the
// nightly belongs to it. A plain package version means that version is already
// released, so the nightly belongs to the next patch. Both rules keep every
// nightly above the current `latest` version and below the next stable version.
export function nightlyBaseVersion(packageVersion: string): string {
  const parts = RELEASE_VERSION_PATTERN.exec(packageVersion);

  if (!parts) {
    throw new Error(`Package version is not a semantic version: ${packageVersion}`);
  }

  const [, major, minor, patch, prerelease] = parts;

  if (prerelease) {
    return `${major}.${minor}.${patch}`;
  }

  return `${major}.${minor}.${Number(patch) + 1}`;
}

export function nightlyDateStamp(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function shortCommit(commit: string): string {
  const normalized = commit.trim().toLowerCase();

  if (!COMMIT_PATTERN.test(normalized)) {
    throw new Error(`Commit is not a hexadecimal Git object name: ${commit}`);
  }

  return normalized.slice(0, 7);
}

export function computeNightlyVersion(input: {
  commit: string;
  date: Date;
  packageVersion: string;
}): string {
  const base = nightlyBaseVersion(input.packageVersion);
  return `${base}-nightly.${nightlyDateStamp(input.date)}.${shortCommit(input.commit)}`;
}

// The published nightly version carries its own source commit. That makes the
// registry the marker for the last nightly, so the workflow needs no Git tag,
// no commit, and no stored file. Read the commit back out to answer whether
// `main` has advanced.
export function commitOfNightlyVersion(version: string): string | undefined {
  return NIGHTLY_VERSION_PATTERN.exec(version)?.[2];
}

export function isNightlyVersion(version: string): boolean {
  return NIGHTLY_VERSION_PATTERN.test(version);
}

export function planNightlyRelease(input: NightlyPlanInput): NightlyPlan {
  const head = shortCommit(input.commit);
  const published = input.publishedNightlyVersion?.trim();

  if (published) {
    const publishedCommit = commitOfNightlyVersion(published);

    if (!publishedCommit) {
      throw new Error(`Published nightly version has an unexpected form: ${published}`);
    }

    if (publishedCommit.startsWith(head) || head.startsWith(publishedCommit)) {
      return {
        publish: false,
        reason: `main is still at ${head}, which the nightly channel already carries as ${published}.`,
      };
    }
  }

  const version = computeNightlyVersion({
    commit: head,
    date: input.date,
    packageVersion: input.packageVersion,
  });

  return {
    publish: true,
    reason: published
      ? `main advanced to ${head} from the published nightly ${published}.`
      : `The nightly channel has no published version yet.`,
    version,
  };
}

// This is the guard that keeps the stable release out of reach. The publish
// command is built in one place and refuses every input that could move the
// stable version or the `latest` dist-tag.
export function buildPublishArguments(input: PublishArgumentsInput): string[] {
  if (input.tag !== NIGHTLY_DIST_TAG) {
    throw new Error(`The nightly workflow publishes only under ${NIGHTLY_DIST_TAG}, not ${input.tag}.`);
  }

  if (!isNightlyVersion(input.version)) {
    throw new Error(`Version ${input.version} is not a nightly version and must not publish here.`);
  }

  const args = [
    "publish",
    input.directory ?? CORE_PACKAGE_DIRECTORY,
    "--access",
    "public",
    "--provenance",
    "--tag",
    NIGHTLY_DIST_TAG,
  ];

  if (input.dryRun) {
    args.push("--dry-run");
  }

  return args;
}

// The workflow writes the nightly version into its own checkout and never
// commits it. Refuse any other value so a manifest edit cannot carry a stable
// version into the nightly publish step.
export function nightlyManifest(manifest: string, version: string): string {
  if (!isNightlyVersion(version)) {
    throw new Error(`Version ${version} is not a nightly version and must not enter the manifest.`);
  }

  const parsed: unknown = JSON.parse(manifest);

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("The package manifest is not a JSON object.");
  }

  const updated = { ...(parsed as Record<string, unknown>), version };
  return `${JSON.stringify(updated, undefined, 2)}\n`;
}
