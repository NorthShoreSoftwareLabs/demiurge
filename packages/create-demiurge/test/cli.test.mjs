/* global process */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const cli = resolve("bin/create-demiurge.mjs");

function withScratch(run) {
  const scratch = mkdtempSync(join(tmpdir(), "create-demiurge-test-"));
  try {
    run(scratch);
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
}

function create(scratch, name, template) {
  execFileSync(process.execPath, [cli, name, "--template", template], {
    cwd: scratch,
    stdio: "pipe",
  });
  return join(scratch, name);
}

test("creates the complete page application", () => {
  withScratch((scratch) => {
    const target = create(scratch, "My Page", "page");
    for (const file of [
      "src/routes/@layout.tsx",
      "src/routes/@not-found.tsx",
      "src/routes/@error.tsx",
      "src/routes/@policy.ts",
      "src/routes/index.tsx",
      "src/styles.css",
      "vite.config.ts",
    ]) {
      assert(existsSync(join(target, file)), `Missing ${file}`);
    }

    const metadata = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
    assert.equal(metadata.name, "my-page");
    assert.equal(metadata.dependencies["@demiurgejs/core"], "^0.1.0");
    assert(!readFileSync(join(target, "src/styles.css"), "utf8").includes("error"));
    assert(!readFileSync(join(target, "src/styles.css"), "utf8").includes("not-found"));
  });
});

test("creates an API application without page files", () => {
  withScratch((scratch) => {
    const target = create(scratch, "service", "api");
    assert(existsSync(join(target, "src/routes/@policy.ts")));
    assert(existsSync(join(target, "src/routes/api/health.ts")));
    assert(!existsSync(join(target, "src/routes/@layout.tsx")));
    assert(!existsSync(join(target, "src/routes/@not-found.tsx")));
    assert(!existsSync(join(target, "src/routes/@error.tsx")));
    assert(!existsSync(join(target, "src/routes/index.tsx")));
    assert(!existsSync(join(target, "src/styles.css")));
  });
});

test("uses page defaults with --yes", () => {
  withScratch((scratch) => {
    execFileSync(process.execPath, [cli, "--yes"], { cwd: scratch, stdio: "pipe" });
    assert(existsSync(join(scratch, "demiurge-app", "src/routes/index.tsx")));
  });
});

test("does not write into a nonempty directory", () => {
  withScratch((scratch) => {
    const target = join(scratch, "existing");
    mkdirSync(target);
    writeFileSync(join(target, "keep.txt"), "keep");
    const result = spawnSync(
      process.execPath,
      [cli, "existing", "--template", "page"],
      { cwd: scratch, encoding: "utf8" },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Target directory is not empty/);
    assert.equal(readFileSync(join(target, "keep.txt"), "utf8"), "keep");
  });
});

test("rejects an unknown template", () => {
  const result = spawnSync(
    process.execPath,
    [cli, "app", "--template", "unknown"],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Template must be/);
});

test("the packed CLI includes and copies both templates", () => {
  withScratch((scratch) => {
    execFileSync("pnpm", ["pack", "--pack-destination", scratch], {
      cwd: resolve("."),
      stdio: "pipe",
    });
    const tarball = readdirSync(scratch).find((file) => file.endsWith(".tgz"));
    assert(tarball, "pnpm pack produced no tarball");

    const unpacked = join(scratch, "unpacked");
    mkdirSync(unpacked);
    execFileSync("tar", ["-xzf", join(scratch, tarball), "-C", unpacked]);
    const packedCli = join(unpacked, "package", "bin", "create-demiurge.mjs");
    const target = join(scratch, "packed-api");
    execFileSync(process.execPath, [packedCli, target, "--template", "api"], {
      stdio: "pipe",
    });

    assert(existsSync(join(target, "src/routes/api/health.ts")));
    assert(existsSync(join(target, "src/routes/@policy.ts")));
    assert(!existsSync(join(target, "src/routes/index.tsx")));
    assert(!existsSync(join(target, "src/routes/@not-found.tsx")));
  });
});
