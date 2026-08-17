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

Nightlies are planned in [GitHub issue #117](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/117)
and are not published until that workflow is available. The workflow will use a
daily schedule. It will run only when `main` has advanced. It will run
`pnpm verify` and assign a unique temporary version. An example version is
`0.2.0-nightly.20260812.a1b2c3d`. It will publish with provenance under `nightly`.

Nightly publication does not commit a version, create a Git tag, or create a
GitHub release. Consumers will opt in explicitly:

```sh
pnpm add @demiurgejs/core@nightly
```

Publishing each individual commit is intentionally avoided because registry
versions are permanent and would create noise without adding a useful testing
window.

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
future. Version 0.2 keeps its current subpath exports in one framework package.

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
