# Contributing

Demiurge uses pnpm workspaces. Framework source is in `packages/core`.
Examples consume the built package through `node_modules`. This configuration
tests the same exports and declarations that external users receive.

## Setup

```sh
pnpm install
pnpm exec playwright install chromium
pnpm verify
```

Use `pnpm dev` to build the framework and run the basic blog example. Use
`pnpm dev:lib` in a second terminal when changing framework source.

## Change requirements

A change is complete when behavior, tests at the layer where it can fail, and
user documentation agree. Developer-facing changes should also update or add an
example. `pnpm verify` must pass before review.

## Pull requests

Give the pull request a Conventional Commits title in the form
`<type>[optional scope][optional !]: <description>`. GitHub squash merges the
pull request, so this title becomes the commit subject on `main`. A required
check rejects a title that does not follow the commit policy in `AGENTS.md`.
Run `node tooling/check-pr-title.ts "<title>"` to check a title locally.

Use GitHub Issues and milestones for work and status. Record an enduring
architectural choice in `architecture/decisions`. Put a substantial unsettled
proposal in `rfcs`. Do not add repository-local task lists or status documents.

See [testing](./docs/maintainers/testing.md) for the verification layers and
[releasing](./docs/maintainers/releasing.md) for the signed release process.
