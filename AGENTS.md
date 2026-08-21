# AGENTS.md

These instructions apply to the entire repository.

## Project contract

Demiurge is a React framework for secure routing, server rendering, and
framework-managed HTML documents. Preserve these framework responsibilities
when you change an API or runtime behavior.

- The published package is `@demiurgejs/core` in `packages/core`.
- Examples are workspace consumers of the built package. Do not add source path
  aliases that bypass package exports, declarations, or peer dependencies.
- Node 22.13 is the supported runtime floor. CI proves both that floor and the
  current Node release.
- Use pnpm and keep `pnpm-lock.yaml` synchronized with workspace changes.

## Repository map

- `packages/core/src`: framework source
- `packages/core/tests`: package-level unit, component, and request tests
- `examples`: buildable consumer applications
- `browser-tests`: Playwright conformance against production output
- `tests/integration`: real-process example probes
- `tests/package`: packed-tarball and clean-consumer verification
- `tooling`: repository build helpers
- `docs`: current user and maintainer documentation
- `architecture`: enduring boundaries and accepted decisions
- `rfcs`: substantial proposals that are not yet accepted

Generated `.demiurge` directories, `dist`, `coverage`, `test-results`, and
`node_modules` are not source. Do not edit or commit them.

## Source of truth

GitHub Issues and milestones are the only source for work status, priority, and
release completion. Do not create tracked task lists, progress ledgers, agent
scratch files, or feature inventories.

- Put current user-visible behavior in `docs`.
- Put an enduring accepted decision in an ADR under `architecture/decisions`.
- Put a substantial unsettled design in `rfcs` and link it to a GitHub issue.
- Keep temporary plans outside the tracked repository.
- Do not describe a version as released until its signed tag, GitHub release,
  and npm artifact exist. Until then, use `Unreleased` or `prepared on main`.

### Issue completion

When work starts from a GitHub issue, complete these steps after the change
reaches `main`:

1. Verify each acceptance criterion against the current repository state.
2. Update the issue title, description, or checklist when the implementation
   changes the documented contract.
3. Add a completion comment that identifies the commit and verification result.
4. Close the implementation issue as completed.
5. Confirm that the project item has the `Done` status.

Do not close an epic until all required issues are complete.

## Change rules

- Keep development, Node production, and static behavior on the shared route
  and document pipelines where their contracts overlap.
- Treat security declarations and adapter capabilities as typed, auditable
  framework inputs. Fail at build or startup when a violation is knowable there.
- Preserve app ownership of pages, layouts, fallbacks, metadata, policy, and
  styles. Do not introduce framework-branded runtime fallbacks.
- Keep server-only data and secrets out of browser bundles. Browser navigation
  receives server data through the typed navigation response boundary.
- Update examples and documentation when developer-facing behavior changes.
- Add a test at the layer where the behavior can actually fail.

## Writing standard

Use [ASD-STE100 Issue 9](https://www.asd-ste100.org/) for all repository prose.
This rule applies to documentation, comments, diagnostics, UI text, issues,
pull requests, and commit bodies.

- Use an approved word when it gives the correct meaning.
- Use project terms and API names as technical names.
- Use one term for one item or action. Do not use synonyms for style.
- Use active voice. Identify the person or system that does the action.
- Write only one instruction in each sentence.
- Use no more than 20 words in an instruction.
- Use no more than 25 words in a descriptive sentence.
- Put a condition before the action that it controls.
- Use short paragraphs and vertical lists for complex information.
- Do not use contractions, slang, idioms, or Latin abbreviations.
- Do not omit articles or other words to make a sentence shorter.

Code symbols, commands, URLs, literal quotations, and legal text do not have to
use the controlled vocabulary. Do not change an API name only to satisfy this
writing standard. Make the text around these items compliant.

Run `pnpm lint:writing` after you change prose. The check finds objective
violations. You must also review terminology, meaning, and active voice.

## Commits

Follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).

```text
<type>[optional scope][optional !]: <description>
```

- Use `feat` for a new user-visible capability and `fix` for a bug fix.
- Use the repository's established `docs`, `test`, `refactor`, `chore`, and
  `release` types when they describe the change more accurately.
- Add a body when the motivation or behavior is not clear from the subject.
- Mark a breaking change with `!` before the colon or a `BREAKING CHANGE:`
  footer, and explain the migration in the commit body.
- Keep commits coherent. Do not mix unrelated cleanup into a feature or fix.
- Give the pull request a title in the same form. GitHub squash merges the pull
  request, so the title becomes the commit subject on `main`. A required check
  rejects a title that does not follow this policy.
- Add a `Refs #123` footer to each commit that relates to an issue.
- For an issue in another repository, use `Refs owner/repository#123`.
- If a direct commit completes all verified criteria, use `Closes #123` instead.
- Do not use a closing keyword for partial work.

## Pull requests

Follow `.github/pull_request_template.md`. Every pull request uses the same
structure, so a reviewer finds the same information in the same place. Write
the title and every section under the [Writing standard](#writing-standard)
above.

1. `## Summary` — one to three sentences. State the problem before the fix.
2. A body section that explains the change, under whichever heading fits:
   `What changed`, `Design decisions`, `Decision rules`, or
   `Implementation notes`. Omit it for a small or mechanical change.
3. `## Verification` — the exact commands you ran and their result. State
   plainly when `pnpm verify` did not run, and why. Do not claim a result you
   did not observe.
4. `## Notes for reviewers` — open questions, known gaps, or things not
   exercised. Omit this section when there are none.
5. A closing footer: `Refs #123` for related or partial work, `Closes #123`
   only when this pull request alone satisfies every acceptance criterion.

Do not add an emoji anywhere in a pull request title or body. Do not add a
signature, attribution line, or "generated with" footer naming a tool,
model, or assistant. A pull request reads as the work, not as a record of
which tool produced it.

The pull request title follows the same Conventional Commits form as a
commit subject, because GitHub squash merges it into one.

## Branches and releases

- Treat protected `main` as the integration branch. Use short-lived branches
  and reviewed pull requests rather than a permanent `develop` branch.
- Do not create routine version branches. A maintenance or stabilization branch
  requires the conditions documented in
  [the release process](./docs/maintainers/releasing.md#branch-policy).
- Stable and deliberate prerelease publication comes from signed `v*` tags.
  Nightlies come only from the scheduled workflow tracked in GitHub issue #117.
- Do not create a release tag, GitHub release, change an npm dist-tag, or publish
  a package without explicit maintainer authorization.
- Read the complete [release process](./docs/maintainers/releasing.md) before
  changing version metadata or release automation.

## Verification

Run the narrowest relevant command while iterating, then run the complete gate
before considering a change finished:

```sh
pnpm lint
pnpm lint:writing
pnpm typecheck
pnpm test
pnpm coverage
pnpm build:examples
pnpm test:examples
pnpm test:browser
pnpm test:pack
pnpm verify
```

`pnpm verify` is authoritative. It covers lint, builds, generated route types,
per-file coverage, example production behavior, browser conformance, and the
packed external-consumer contract.

When package metadata or exports change, `pnpm test:pack` is mandatory. When
document, navigation, CSP, cookies, or browser security behavior changes,
`pnpm test:browser` is mandatory.
