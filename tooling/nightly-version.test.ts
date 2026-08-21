import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPublishArguments,
  commitOfNightlyVersion,
  computeNightlyVersion,
  isNightlyVersion,
  nightlyBaseVersion,
  nightlyManifest,
  planNightlyRelease,
} from "./nightly-version";

const date = new Date(Date.UTC(2026, 7, 12));
const commit = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

test("builds the version from the unreleased package version", () => {
  assert.equal(
    computeNightlyVersion({ commit, date, packageVersion: "0.2.0-beta.2" }),
    "0.2.0-nightly.20260812.a1b2c3d",
  );
});

// A plain package version is already on the registry under `latest`. The
// nightly must sort above it, so it belongs to the next patch version.
test("moves to the next patch when the package version is already released", () => {
  assert.equal(nightlyBaseVersion("0.2.0"), "0.2.1");
  assert.equal(nightlyBaseVersion("0.2.0-beta.2"), "0.2.0");
  assert.equal(nightlyBaseVersion("1.4.9-rc.1"), "1.4.9");
});

test("refuses a package version that is not a semantic version", () => {
  assert.throws(() => nightlyBaseVersion("latest"), /not a semantic version/);
});

test("refuses a commit that is not a Git object name", () => {
  assert.throws(
    () => computeNightlyVersion({ commit: "not-a-commit", date, packageVersion: "0.2.0" }),
    /hexadecimal Git object name/,
  );
});

test("reads the source commit back out of a published nightly version", () => {
  assert.equal(commitOfNightlyVersion("0.2.0-nightly.20260812.a1b2c3d"), "a1b2c3d");
  assert.equal(commitOfNightlyVersion("0.2.0"), undefined);
  assert.equal(commitOfNightlyVersion("0.2.0-beta.2"), undefined);
});

test("publishes when the nightly channel is empty", () => {
  const plan = planNightlyRelease({ commit, date, packageVersion: "0.2.0-beta.2" });
  assert.equal(plan.publish, true);
  assert.equal(plan.version, "0.2.0-nightly.20260812.a1b2c3d");
});

test("skips when main has not advanced past the published nightly", () => {
  const plan = planNightlyRelease({
    commit,
    date,
    packageVersion: "0.2.0-beta.2",
    publishedNightlyVersion: "0.2.0-nightly.20260810.a1b2c3d",
  });

  assert.equal(plan.publish, false);
  assert.equal(plan.version, undefined);
});

test("publishes when main advanced past the published nightly", () => {
  const plan = planNightlyRelease({
    commit,
    date,
    packageVersion: "0.2.0-beta.2",
    publishedNightlyVersion: "0.2.0-nightly.20260810.9999999",
  });

  assert.equal(plan.publish, true);
  assert.equal(plan.version, "0.2.0-nightly.20260812.a1b2c3d");
});

test("refuses a published nightly version it cannot read a commit from", () => {
  assert.throws(
    () =>
      planNightlyRelease({
        commit,
        date,
        packageVersion: "0.2.0-beta.2",
        publishedNightlyVersion: "0.2.0",
      }),
    /unexpected form/,
  );
});

// These are the tests that prove the stable channel is out of reach. The
// nightly workflow builds its npm arguments only here, and this is the only
// shape those arguments can take.
test("always publishes under the nightly dist-tag", () => {
  assert.deepEqual(
    buildPublishArguments({ tag: "nightly", version: "0.2.0-nightly.20260812.a1b2c3d" }),
    ["publish", "./packages/core", "--access", "public", "--provenance", "--tag", "nightly"],
  );
});

test("refuses to publish under the latest dist-tag", () => {
  for (const tag of ["latest", "next", ""]) {
    assert.throws(
      () => buildPublishArguments({ tag, version: "0.2.0-nightly.20260812.a1b2c3d" }),
      /publishes only under nightly/,
    );
  }
});

test("refuses to publish a stable or deliberate prerelease version", () => {
  for (const version of ["0.2.0", "0.2.0-beta.2", "0.3.0-rc.1", "0.2.0-nightly.20260812"]) {
    assert.throws(
      () => buildPublishArguments({ tag: "nightly", version }),
      /not a nightly version/,
    );
  }
});

test("adds the dry-run argument on request", () => {
  const args = buildPublishArguments({
    dryRun: true,
    tag: "nightly",
    version: "0.2.0-nightly.20260812.a1b2c3d",
  });

  assert.equal(args.at(-1), "--dry-run");
});

test("recognizes only a complete nightly version", () => {
  assert.equal(isNightlyVersion("0.2.0-nightly.20260812.a1b2c3d"), true);
  assert.equal(isNightlyVersion("0.2.0-nightly.2026812.a1b2c3d"), false);
  assert.equal(isNightlyVersion("0.2.0-nightly.20260812.zzzzzzz"), false);
});

test("writes only a nightly version into the manifest", () => {
  const manifest = JSON.stringify({ name: "@demiurgejs/core", version: "0.2.0-beta.2" });

  assert.equal(
    JSON.parse(nightlyManifest(manifest, "0.2.0-nightly.20260812.a1b2c3d")).version,
    "0.2.0-nightly.20260812.a1b2c3d",
  );
  assert.throws(() => nightlyManifest(manifest, "0.2.0"), /not a nightly version/);
});
