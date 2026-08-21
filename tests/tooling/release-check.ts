import { readFileSync } from "node:fs";

import { checkRelease } from "../../tooling/release-check";

// Unit tests for the release metadata check. The packed-consumer test stays
// authoritative for tarball contents and external-consumer behavior. This file
// only tests the metadata rules that guard a signed tag.

const validManifest = {
  name: "@demiurgejs/core",
  repository: {
    directory: "packages/core",
    type: "git",
    url: "git+https://github.com/NorthShoreSoftwareLabs/demiurge.git",
  },
  version: "0.1.0",
};

const validChangelog = ["# Changelog", "", "## 0.1.0 — 2026-08-13", "", "- A change."].join("\n");

let failureCount = 0;

check("accepts consistent stable release metadata", () => {
  expectNoFailures(
    checkRelease({
      changedTrackedFiles: [],
      changelog: validChangelog,
      packageManifest: validManifest,
      tag: "v0.1.0",
    }),
  );
});

check("rejects a tag that does not match the package version", () => {
  expectFailure(
    checkRelease({
      changedTrackedFiles: [],
      changelog: validChangelog,
      packageManifest: validManifest,
      tag: "v0.1.1",
    }),
    "does not match the package version",
  );
});

check("rejects a tag without the version prefix", () => {
  expectFailure(
    checkRelease({
      changedTrackedFiles: [],
      changelog: validChangelog,
      packageManifest: validManifest,
      tag: "0.1.0",
    }),
    "does not match the package version",
  );
});

check("rejects a missing tag", () => {
  expectFailure(
    checkRelease({
      changedTrackedFiles: [],
      changelog: validChangelog,
      packageManifest: validManifest,
      tag: "",
    }),
    "No tag was supplied",
  );
});

check("rejects another package name", () => {
  expectFailure(
    checkRelease({
      changedTrackedFiles: [],
      changelog: validChangelog,
      packageManifest: { ...validManifest, name: "@other/core" },
      tag: "v0.1.0",
    }),
    "Set the name to @demiurgejs/core",
  );
});

check("rejects repository metadata for another repository", () => {
  expectFailure(
    checkRelease({
      changedTrackedFiles: [],
      changelog: validChangelog,
      packageManifest: {
        ...validManifest,
        repository: { directory: "packages/core", url: "git+https://github.com/other/demiurge.git" },
      },
      tag: "v0.1.0",
    }),
    "does not identify NorthShoreSoftwareLabs/demiurge",
  );
});

check("rejects a missing package directory", () => {
  expectFailure(
    checkRelease({
      changedTrackedFiles: [],
      changelog: validChangelog,
      packageManifest: {
        ...validManifest,
        repository: { url: "git+https://github.com/NorthShoreSoftwareLabs/demiurge.git" },
      },
      tag: "v0.1.0",
    }),
    "repository.directory must be packages/core",
  );
});

check("rejects a changelog without a heading for the version", () => {
  expectFailure(
    checkRelease({
      changedTrackedFiles: [],
      changelog: "# Changelog\n\n## 0.0.9 — 2026-08-01\n",
      packageManifest: validManifest,
      tag: "v0.1.0",
    }),
    "has no heading for version 0.1.0",
  );
});

check("rejects a stable version that the changelog marks Unreleased", () => {
  expectFailure(
    checkRelease({
      changedTrackedFiles: [],
      changelog: "# Changelog\n\n## 0.1.0 — Unreleased\n",
      packageManifest: validManifest,
      tag: "v0.1.0",
    }),
    "still marks version 0.1.0 as Unreleased",
  );
});

check("accepts a prerelease under an open release line", () => {
  expectNoFailures(
    checkRelease({
      changedTrackedFiles: [],
      changelog: "# Changelog\n\n## 0.2.0 — Unreleased\n",
      packageManifest: { ...validManifest, version: "0.2.0-beta.2" },
      tag: "v0.2.0-beta.2",
    }),
  );
});

check("rejects a prerelease without a heading for its release line", () => {
  expectFailure(
    checkRelease({
      changedTrackedFiles: [],
      changelog: "# Changelog\n\n## 0.1.0 — 2026-08-13\n",
      packageManifest: { ...validManifest, version: "0.2.0-beta.2" },
      tag: "v0.2.0-beta.2",
    }),
    "has no heading for version 0.2.0-beta.2 or 0.2.0",
  );
});

check("rejects a tracked working tree that changed during verification", () => {
  expectFailure(
    checkRelease({
      changedTrackedFiles: ["pnpm-lock.yaml"],
      changelog: validChangelog,
      packageManifest: validManifest,
      tag: "v0.1.0",
    }),
    "changed during release verification",
  );
});

check("rejects a manifest that is not an object", () => {
  expectFailure(
    checkRelease({
      changedTrackedFiles: [],
      changelog: validChangelog,
      packageManifest: "not-a-manifest",
      tag: "v0.1.0",
    }),
    "is not a JSON object",
  );
});

check("accepts the current repository metadata under its own tag", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../../packages/core/package.json", import.meta.url), "utf8"),
  );
  const changelog = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");

  expectNoFailures(
    checkRelease({
      changedTrackedFiles: [],
      changelog,
      packageManifest: manifest,
      tag: `v${manifest.version}`,
    }),
  );
});

if (failureCount > 0) {
  console.error(`\n${failureCount} release-check test failure(s).`);
  process.exitCode = 1;
} else {
  console.log("release-check tests passed.");
}

function check(name: string, body: () => void) {
  try {
    body();
    console.log(`ok - ${name}`);
  } catch (error) {
    failureCount += 1;
    console.error(`not ok - ${name}: ${(error as Error).message}`);
  }
}

function expectNoFailures(failures: readonly string[]) {
  if (failures.length > 0) {
    throw new Error(`expected no failures, received: ${failures.join(" | ")}`);
  }
}

function expectFailure(failures: readonly string[], fragment: string) {
  if (!failures.some((failure) => failure.includes(fragment))) {
    throw new Error(`expected a failure containing "${fragment}", received: ${failures.join(" | ")}`);
  }
}
