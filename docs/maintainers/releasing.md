# Release process

Demiurge releases are built from a signed version tag in a clean checkout. The
tag workflow runs the complete verification suite. It tests the packed artifact
with an external consumer. It then publishes with npm provenance and creates the
matching GitHub release. A local build is never uploaded directly.

## Release model

`main` is the protected integration branch and the source of releases. Work
lands through short-lived branches and reviewed pull requests. There is no
permanent `develop` branch. Every merge to `main` must keep the complete
verification gate green and leave the repository in a releasable state.

| Channel | Source | npm dist-tag | Use |
| --- | --- | --- | --- |
| Nightly | Latest verified `main` | `nightly` | Early, unsupported integration testing |
| Prerelease | Signed beta or release-candidate tag | `next` | Deliberate release testing |
| Stable | Signed stable version tag | `latest` | Production consumers |

The default installation must always resolve to `latest`. A prerelease or
nightly must never move that dist-tag.

Protect `main` with required CI, review, conversation resolution, and no direct
pushes. Protect `v*` tags so only the release workflow or authorized maintainers
can create them.

## Branch policy

Do not create a release branch for every version. A long-lived maintenance
branch such as `1.x` is justified only when that released line still receives
fixes while `main` contains incompatible later work. A temporary
`release/0.2` branch is justified only when an extended stabilization period
must proceed while `main` advances toward the next version.

For an isolated patch, create a branch from the released tag. Apply and verify
the fix. Publish the new patch tag. Then, apply the fix to `main`. Retain a
maintenance branch only when that line requires more fixes.

## Nightly channel

The nightly channel is unsupported prerelease software. It carries whatever
`main` contained at build time. It has no compatibility promise, no deprecation
period, and no patch line. Use it for early integration testing only. Never
depend on it from a production application.

Consumers opt in explicitly:

```sh
pnpm add @demiurgejs/core@nightly
```

Pin the exact nightly version in an application that must reproduce a build.
The `nightly` dist-tag moves every time the workflow publishes.

Only `@demiurgejs/core` publishes to this channel. The `create-demiurge`
scaffold publishes from signed version tags alone.

### How the nightly workflow runs

[The nightly workflow](../../.github/workflows/nightly.yml) runs on a daily
schedule and on maintainer dispatch. It has three jobs:

1. `plan` decides whether `main` advanced and names the version.
2. `verify` runs the complete `pnpm verify` gate against `main`.
3. `publish` writes the version into the workflow checkout and publishes it.

A `concurrency` group named `nightly-publish` serializes the workflow. Two runs
that started together would compute one version from one commit, and the second
publication would fail on a version the registry already holds.

### How the workflow detects an advanced main

The published nightly version carries its own source commit. An example version
is `0.2.0-nightly.20260812.a1b2c3d`, where `a1b2c3d` is the short commit name.
The `plan` job reads the current `nightly` version from the registry and
compares that commit against the head of `main`. Equal commits skip the run.

The registry is therefore the marker for the last nightly. This choice needs no
Git tag, no commit on `main`, and no state file in the repository. A version
that npm rejects also never becomes the marker, so a failed publication leaves
the next run free to retry the same commit.

### How the version is computed

`tooling/nightly-version.ts` holds the rules as pure functions. The base version
comes from `packages/core/package.json`:

- A prerelease package version such as `0.2.0-beta.2` is not released yet, so
  the nightly belongs to `0.2.0`.
- A plain package version such as `0.2.0` is already released under `latest`, so
  the nightly belongs to the next patch, `0.2.1`.

Both rules place every nightly version above the current `latest` version and
below the next stable version.

### How the stable channel stays out of reach

Two independent guards protect the stable version and the `latest` dist-tag:

1. Every nightly version carries a `nightly` prerelease identifier. npm never
   assigns `latest` to a prerelease version.
2. `tooling/nightly-release.ts` builds the one permitted npm command. It refuses
   any dist-tag other than `nightly`. It refuses any version without the
   `nightly` prerelease identifier. It also refuses to write a version of any
   other form into the package manifest.

The nightly workflow contains no other publish command. `tooling/nightly-version.test.ts`
proves each refusal, and `pnpm test:tooling` runs those tests inside
`pnpm verify`. The `publish` job runs the command once with `--dry-run` before
the real publication. Then the job proves that the temporary version reached no
commit and no tag.

Nightly publication does not commit a version, create a Git tag, or create a
GitHub release. The version exists only in the workflow checkout.

Publishing each individual commit is intentionally avoided because registry
versions are permanent and would create noise without adding a useful testing
window.

### Inspect the nightly decision locally

Print the decision and the version without touching the registry:

```sh
pnpm nightly:plan --published none
pnpm nightly:plan --published 0.2.0-nightly.20260812.a1b2c3d
```

Run the complete publish path without publishing:

```sh
pnpm nightly:publish --version 0.2.0-nightly.20260812.a1b2c3d --dry-run
```

The dry run rewrites `packages/core/package.json` in the working tree. Restore
that file with `git checkout packages/core/package.json` afterward.

### One-time nightly setup

Configure npm trusted publishing for `.github/workflows/nightly.yml` in
addition to `.github/workflows/release.yml`. The protected `npm` environment
gates the `publish` job. Allow `main` for that environment, or give the nightly
workflow its own environment when the tag restriction must stay.

## Prereleases

Beta and release-candidate versions use normal signed tags:

```text
v0.2.0-beta.1
v0.2.0-rc.1
```

The release workflow maps any semantic version containing a prerelease suffix
to the `next` dist-tag. Prereleases run the same verification, packed-consumer,
provenance, and GitHub Release steps as stable versions. Consumers opt in with:

```sh
pnpm add @demiurgejs/core@next
```

## Published packages

One version tag releases two packages at one version:

| Package | Directory | Purpose |
| --- | --- | --- |
| `@demiurgejs/core` | `packages/core` | The framework |
| `create-demiurge` | `packages/create-demiurge` | The `npm create demiurge` scaffold |

The scaffold carries the framework version because its template pins
`@demiurgejs/core`. A drifted version would scaffold an application against a
framework release that does not exist. `pnpm test:scaffold` asserts both the
shared version and the template pin, so a forgotten bump fails the gate.

Set both versions and the template pin together in the release commit. The
release workflow checks the shared version again before it publishes.

The scaffold publishes in its own job after the framework release. A scaffold
registry failure therefore cannot withhold the framework artifact or the GitHub
release. Rerun that job alone to recover.

The `@demiurgejs` scope permits independently versioned adapters or tools in the
future. Versions 0.2 and 0.3 keep their current subpath exports in one
framework package. See
[ADR 0006](../../architecture/decisions/0006-single-package-optional-adapter-dependencies.md)
for host-specific dependencies within that one package.

## Release metadata check

`pnpm release:check -- v0.2.0` validates the release metadata of one tag. Run it
locally before you create the tag. The release workflow runs the same command
after verification and before publication.

The check fails when one of these conditions is true:

- The tag is not exactly `v` plus the version in `packages/core/package.json`.
- The package name is not `@demiurgejs/core`.
- The package repository metadata does not identify
  `NorthShoreSoftwareLabs/demiurge` and `packages/core`.
- The root `CHANGELOG.md` has no heading for the version.
- A stable version still carries the `Unreleased` marker.
- A tracked file changed during release verification.

A prerelease belongs to a release line that is still open. Therefore, the
heading of a prerelease can be the exact version or the release line, and it can
keep the `Unreleased` marker. The version `0.2.0-beta.2` accepts a `0.2.0`
heading. A stable version requires its own dated heading.

`pnpm test:tooling` runs the unit tests for these rules. `pnpm test:pack` stays
authoritative for tarball contents and external-consumer behavior.

## One-time registry setup

Demiurge publishes from the `@demiurgejs` npm scope and the unscoped
`create-demiurge` name.

Before the first public release:

1. Create or claim the `@demiurgejs` npm organization and grant the maintainers
   publish access to `@demiurgejs/core`.
1. Claim the unscoped `create-demiurge` name. npm configures trusted publishing
   on a package that already exists. Publish the first version from a maintainer
   account. Then configure trusted publishing for
   `.github/workflows/release.yml`. The workflow publishes every later version.
2. Configure npm trusted publishing for this repository and
   `.github/workflows/release.yml`.
3. Create a protected GitHub environment named `npm`, require maintainer
   approval, and restrict it to version tags.
4. Leave the package's `publishConfig.provenance` and public access settings in
   place. Do not add a long-lived npm token when trusted publishing is
   available.

The release workflow refuses to overwrite a package name whose npm repository
metadata points somewhere other than this repository.

## Stable release checklist

1. Close every `p1` issue in the target milestone. The workflow checks this
   again from GitHub before publishing.
2. Choose the version using semantic versioning. Stable releases use npm's
   `latest` dist-tag. Prerelease versions containing `-` use `next`.
3. Set `packages/core/package.json` and `packages/create-demiurge/package.json`
   to that exact version. Set the template pin in
   `packages/create-demiurge/templates/shared/package.json` to `^` plus that
   version. Turn the matching changelog heading from `Unreleased` into the
   release date. Commit those changes through the normal reviewed branch.
4. From a fresh clone of that commit, run:

   ```sh
   corepack enable
   pnpm install --frozen-lockfile
   pnpm verify
   pnpm release:check -- v0.1.0
   npm pack --dry-run --json ./packages/core
   ```

   Inspect the final manifest: it must contain only the declared package files,
   including `README.md`, `LICENSE`, declarations, source maps, and executable
   output under `dist`.
5. Confirm `git status --short` is empty. Create and push a signed annotated tag
   whose name is exactly `v` plus the package version:

   ```sh
   git tag -s v0.1.0 -m "Demiurge v0.1.0"
   git tag -v v0.1.0
   git push origin v0.1.0
   ```

   `scripts/release-tag.sh <version>` runs steps 5 and 6 as one command. It
   refuses to touch a tag with an existing GitHub release, cleans up a failed
   prior attempt, and watches the workflow to completion:

   ```sh
   scripts/release-tag.sh 0.2.0-beta.2
   ```

   Tag signing needs a working local signer. GPG through `pinentry-curses` or
   `pinentry-tty` depends on the terminal's controlling TTY and gpg-agent
   state. That dependency is a common source of a signing step that cancels
   or hangs. SSH-based signing avoids it:

   ```sh
   git config --global gpg.format ssh
   git config --global user.signingkey ~/.ssh/id_ed25519.pub
   git config --global gpg.ssh.allowedSignersFile ~/.ssh/allowed_signers
   echo "<your-github-email> $(cat ~/.ssh/id_ed25519.pub)" >> ~/.ssh/allowed_signers
   ```

   Then register that key on GitHub as a **Signing Key** (not an
   Authentication Key), at Settings → SSH and GPG keys → New SSH key. GitHub
   verifies an SSH-signed tag the same way it verifies a GPG-signed one. The
   release workflow's `Require a verified annotated tag` step does not care
   which signature type produced `verification.verified: true`.

6. Approve the protected `npm` environment after the release workflow has
   passed its verification job. The workflow verifies the tag signature,
   publishes with Sigstore provenance, and creates a GitHub release only after
   npm succeeds.
7. Install the published version by exact version in a new empty directory and
   run the package README's minimal Vite example. Confirm the npm provenance
   badge, README, license, repository, issue tracker, Node engine, and dist-tag.

Never reuse or move a released version tag. Fix a failed release with a new
patch or prerelease version. Changing a dist-tag is an explicit maintainer
operation and is not part of the normal workflow.
