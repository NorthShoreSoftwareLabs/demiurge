# Release process

Demiurge releases are built from a signed version tag in a clean checkout. The
tag workflow reruns the complete verification suite, checks the packed artifact
through an external consumer, publishes with npm provenance, and creates the
matching GitHub release. A local build is never uploaded directly.

## One-time registry setup

Demiurge publishes from the `@demiurge` npm scope. The first package is
`@demiurge/core`; the scope leaves room for independently versioned adapters or
tooling later without forcing the 0.1 package's existing subpath exports into
separate packages now.

Before the first public release:

1. Create or claim the `@demiurge` npm organization and grant the maintainers
   publish access to `@demiurge/core`.
2. Configure npm trusted publishing for this repository and
   `.github/workflows/release.yml`.
3. Create a protected GitHub environment named `npm`, require maintainer
   approval, and restrict it to version tags.
4. Leave the package's `publishConfig.provenance` and public access settings in
   place. Do not add a long-lived npm token when trusted publishing is
   available.

The release workflow refuses to overwrite a package name whose npm repository
metadata points somewhere other than this repository.

## Release checklist

1. Close every `p1` issue in the target milestone. The workflow checks this
   again from GitHub before publishing.
2. Choose the version using semantic versioning. Stable releases use npm's
   `latest` dist-tag; prerelease versions containing `-` use `next`.
3. Set `packages/demiurge/package.json` to that exact version and turn the
   matching changelog heading from `Unreleased` into the release date. Commit
   those changes through the normal reviewed branch.
4. From a fresh clone of that commit, run:

   ```sh
   corepack enable
   pnpm install --frozen-lockfile
   pnpm verify
   npm pack --dry-run --json ./packages/demiurge
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
