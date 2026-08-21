import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

import {
  CORE_PACKAGE_DIRECTORY,
  NIGHTLY_DIST_TAG,
  buildPublishArguments,
  isNightlyVersion,
  nightlyManifest,
  planNightlyRelease,
  type NightlyPlan,
} from "./nightly-version";

// The nightly channel entry point. `plan` decides whether main advanced and
// names the version. `publish` writes that version into this checkout and
// hands the one permitted npm command to the registry. The stable release
// keeps its own workflow and its own signed tag.
//
// Usage:
//   tsx tooling/nightly-release.ts plan [--published <version|none>]
//   tsx tooling/nightly-release.ts publish --version <version> [--dry-run]

const manifestPath = `${CORE_PACKAGE_DIRECTORY}/package.json`;

const [command, ...rest] = process.argv.slice(2);
const options = parseOptions(rest);

if (command === "plan") {
  runPlan();
} else if (command === "publish") {
  runPublish();
} else {
  console.error("Use `plan` or `publish`.");
  process.exit(1);
}

function runPlan() {
  const packageVersion = readPackageVersion();
  const plan = planNightlyRelease({
    commit: headCommit(),
    date: new Date(),
    packageVersion,
    publishedNightlyVersion: publishedNightlyVersion(),
  });

  report(plan);
  writeStepOutputs(plan);
}

function runPublish() {
  const version = options.get("version");

  if (!version || !isNightlyVersion(version)) {
    console.error(`Publish needs --version with a nightly version. Received: ${version ?? "nothing"}`);
    process.exit(1);
  }

  const dryRun = options.has("dry-run");
  const args = buildPublishArguments({ dryRun, tag: NIGHTLY_DIST_TAG, version });

  writeFileSync(manifestPath, nightlyManifest(readFileSync(manifestPath, "utf8"), version));
  console.log(`Set ${manifestPath} to ${version} in this checkout only.`);
  console.log(`npm ${args.join(" ")}`);

  const result = spawnSync("npm", args, { stdio: "inherit" });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function report(plan: NightlyPlan) {
  if (plan.publish) {
    console.log(`Publish ${plan.version} under the ${NIGHTLY_DIST_TAG} dist-tag.`);
  } else {
    console.log("Skip the nightly publication.");
  }

  console.log(plan.reason);
}

function writeStepOutputs(plan: NightlyPlan) {
  const outputPath = process.env.GITHUB_OUTPUT;

  if (!outputPath) {
    return;
  }

  appendFileSync(outputPath, `publish=${plan.publish}\nversion=${plan.version ?? ""}\n`);
}

function readPackageVersion(): string {
  const version: unknown = JSON.parse(readFileSync(manifestPath, "utf8")).version;

  if (typeof version !== "string") {
    throw new Error(`${manifestPath} has no version string.`);
  }

  return version;
}

function headCommit(): string {
  const override = options.get("commit");

  if (override) {
    return override;
  }

  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

// The published nightly version is the only marker of the last nightly. It
// carries its own source commit, so the registry answers whether main advanced
// without a Git tag, a commit, or a stored file. `--published` supplies the
// same answer offline for a local dry run.
function publishedNightlyVersion(): string | undefined {
  const override = options.get("published");

  if (override) {
    return override === "none" ? undefined : override;
  }

  const packageName = JSON.parse(readFileSync(manifestPath, "utf8")).name;
  const result = spawnSync("npm", ["view", `${packageName}@${NIGHTLY_DIST_TAG}`, "version"], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    console.log(`No published ${NIGHTLY_DIST_TAG} version is readable from the registry.`);
    return undefined;
  }

  return result.stdout.trim() || undefined;
}

function parseOptions(args: string[]): Map<string, string> {
  const parsed = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith("--")) {
      continue;
    }

    const name = arg.slice(2);
    const next = args[index + 1];

    if (next && !next.startsWith("--")) {
      parsed.set(name, next);
      index += 1;
    } else {
      parsed.set(name, "true");
    }
  }

  return parsed;
}
