# RFC 0455: CSP External Resource Verification

## Status

Proposed.

Tracking: [GitHub issue #455](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/455).

## Context

Applications can add external resources directly to document and layout JSX.
These resources bypass `defineScripts`, analytics integrations, and route security
needs. The static policy verifier therefore cannot compare them with the
effective Content Security Policy (CSP).

A production application exposed this gap through three failures. A Google
Fonts stylesheet lacked a matching `style-src` source. Its font files lacked a
matching `font-src` source. Google Tag Manager also used an inline script that
the policy did not allow.

Third-party code created inline style attributes at run time. Static source
inspection cannot predict this behavior.

Demiurge already scans the route tree once during development and production
builds. The `demiurge inspect` command uses the same result. Development logs
findings as warnings, while a production build stops for error findings.

## Goals

- Find statically provable CSP conflicts in document and layout JSX.
- Give one repair that uses a typed framework declaration.
- Keep development, build, and inspection results consistent.
- State the cases that static analysis cannot verify.
- Add run-time reporting as a separate development safety net.

## Non-goals

- Evaluate arbitrary React code during a build.
- Download external stylesheets or scripts during a build.
- Prove that unvisited browser behavior satisfies the CSP.
- Replace browser conformance tests with static analysis.
- Infer every resource that third-party code can create.

## Decision

Implement the work in three phases. Add the route needs first. Add conservative
static verification second. Add development reporting as a separate safety net.

### Phase 1: Add style and font route needs

Add `security.needs.style` and `security.needs.font` to
`RouteSecurityNeeds`. Map these needs to `styleSrc` and `fontSrc` in the
existing route need table.

The existing merge logic will accumulate sources from root to leaf. It will
remove duplicates and preserve declaration order. The existing validation will
reject a need when its paired CSP directive is `false`.

Update analytics policy merging to retain the two new lanes. Keep script
traffic needs separate because that contract describes traffic caused by a
script.

`security.needs.style` widens `style-src`. An explicit `style-src-elem`
continues to override that directive for stylesheet elements. A diagnostic must
name `style-src-elem` when that explicit directive blocks a stylesheet.

The same rule already applies to `script-src-elem` and `script-src`.
Align the run-time script audit with this directive chain before the scanner
uses it.

`security.needs.font` authorizes a font source. It does not infer font sources
from an external stylesheet. Applications must declare those sources or use a
framework font declaration.

Estimated effort: one half to one engineer day, including tests,
documentation, and complete verification.

### Phase 2: Scan literal JSX resources

Extend the route policy inspection with literal resource references. Start with
these forms:

- An external `src` on a native `script` element.
- An external `href` on a stylesheet `link` element.
- An external CSS `@import` in a native `style` element.
- An inline native `script` or `style` element.

The scanner must accept string literals and template literals without
expressions. Skip computed values, spreads, helper components, and run-time DOM
changes.

Do not fail a build for an unreadable value. Existing static verification uses
the same certainty rule.

Transform TypeScript and JSX with the existing Vite and esbuild pipeline. Scan
the stable transformed element calls unless an existing parser preserves JSX
without a new dependency.

Check resources against the effective directive chain:

- Scripts use `script-src-elem`, then `script-src`, then `default-src`.
- Stylesheets use `style-src-elem`, then `style-src`, then `default-src`.
- Font resources use `font-src`, then `default-src`.

Create one resource URL matcher for static and run-time verification. Define
scheme, host, port, wildcard, and path behavior from the CSP grammar.

Do not reuse the current origin matcher without extending it. That matcher does
not enforce a path in a CSP source expression.

An external stylesheet URL proves only the stylesheet origin. It does not prove
the origins of font files or other resources inside the stylesheet.

Inline script and style checks must account for nonce and hash policy. A raw
inline script should direct the application to the declarative script API when
that API fits.

#### Route and layout ownership

A layout can apply to several routes. Descendant policies can also narrow its
effective CSP.

For each resource, enumerate the page and fallback documents that inherit its
file. Use the route manifest attachment rules for route groups and nested
layouts. Respect a statically readable `layout: false` declaration.

Merge ancestor policies and the route policy in run-time order. Skip a
route-resource pair when an applicable policy is not statically readable.

Deduplicate the final findings. Each message must name the source file, the
resource origin, the effective directive, and the affected route context.

Add specific finding codes to the shared closed diagnostic vocabulary. A code
must identify one condition in both static and run-time findings.

The finding container identifies whether the build verifier or run-time audit
reported the condition.

Estimated effort: three to five engineer days for external script and
stylesheet literals. Full layout handling and inline checks increase the total
to one or two weeks.

### Phase 3: Collect CSP reports during development

Add a development-only report endpoint under the reserved `/_demiurge`
namespace. Append its URL to `report-uri` without removing application report
targets.

The endpoint must accept only `POST` requests. It must impose a small request
body limit and validate the report shape. It must return `204` without storing
the report.

Treat every report field as untrusted input. Remove control characters and do
not log query strings, fragments, referrers, or complete script samples.

Deduplicate repeated reports in a bounded, expiring cache. Apply a log rate
limit so unique reports cannot flood the terminal or retain unbounded state.

Log the effective directive, blocked origin, document path, source location,
and disposition when those fields are safe and available.

Use `report-uri` for the initial implementation. `report-to` also requires a
reporting endpoint group and has less predictable delivery behavior.

This endpoint belongs to the Vite development adapter. It must not enter Node
production, static output, or generated deployment artifacts.

CSP reports are asynchronous and best-effort. They detect only behavior that a
browser exercises. They cannot make a normal production build fail.

A post-build browser crawl is separate conformance work. It requires route
discovery and explicit authenticated-state coverage.

Estimated effort: four to seven engineer days for a hardened development
collector. A post-build crawler needs approximately one to two weeks.

## Verification

Phase 1 needs policy tests for all five route need lanes. Tests must cover
inheritance, duplicate removal, `default-src` fallback, and disabled
directives.

Phase 2 needs extraction tests for literal and dynamic JSX forms. Route-tree
tests must cover nested layouts, route groups, fallback documents, unknown
policies, and `layout: false`.

Plugin tests must prove development warnings and production build failures.
An integration fixture must reproduce a blocked stylesheet and external script.

Phase 3 needs request validation, size limit, sanitization, and duplicate tests.
A browser test must send a report for an early blocked resource. Tests must
also prove that production output contains no default report endpoint.

Run `pnpm verify` after each implementation phase.

## Consequences

Applications receive typed declarations for manually added styles and fonts.
The build catches literal resource mismatches where the route policy is
statically readable.

Dynamic resources and third-party DOM changes remain outside static proof.
Development reporting reduces this gap only for browser paths that a person or
test visits.

The verifier will state uncertainty by omitting an unprovable finding. It will
not claim that an unreadable resource or policy is safe.

## Follow-up issues

Create one implementation issue for the style and font route needs. Create a
second issue for static JSX verification after the first API is accepted.

Create a third issue for the development report collector. Keep a post-build
browser crawler outside that issue.
