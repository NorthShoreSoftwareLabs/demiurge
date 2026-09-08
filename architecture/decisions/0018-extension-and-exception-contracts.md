# ADR 0018: Extension and Security Exception Contracts

## Status

Accepted.

## Context

Demiurge ships several security defaults. Each default arrived in a separate
change. Each default brought its own escape hatch. The hatches do not agree
with each other.

Issue #404 asks for one contract. A survey of `main` at commit `0aa62f8` found
four disagreements.

- Only one exception requires a justification. `RouteAccessException.reason` is
  mandatory at `packages/core/src/security/types.ts:327`. The `csp: false`,
  `csrf: false`, and raised `maxBodySize` exceptions accept no reason.
- The audit reports some exceptions and hides others. `createSecurityAudit(...)`
  reports the document and route exceptions. The upload policy exception in
  `packages/core/src/security/upload.ts` reaches no audit surface, because an
  application calls `validateUploads` inside its own handler. The environment
  exceptions `optional`, `deferred`, and `client` reach no audit surface either.
- A framework helper declares an exception that looks like an application
  decision. `webhook.hmac()` sets `csrf: false` at
  `packages/core/src/route/webhook.ts:49`. The audit gives the same
  `csrf-disabled` finding for this helper and for an application declaration.
- Two audit systems produce the same code strings for different types. The
  runtime audit types `SecurityAuditFinding.code` as `string`. The build
  verifier types `StaticPolicyFinding.code` as a closed union. The strings
  `access-declaration-missing`, `cors-invalid`, and
  `security-header-render-failed` exist in both. The string `csp-missing` and
  the string `document-policy-missing` name the same gap in the two systems.

The roadmap product rule in issue #393 states that a security exception stays
local, typed, and inspectable. The route exceptions meet the three properties.
The environment and upload exceptions meet one property.

## Decision

### A security exception states a reason

Every typed security exception takes a mandatory `reason` string. This applies
to `csp: false`, to `csrf: false`, and to a `maxBodySize` value above the
default. `RouteAccessException.reason` already meets this rule and does not
change.

The audit reports the reason with the finding. A reader of the audit learns
what the application accepted and why the application accepted it.

This change breaks an application that declares one of these exceptions today.
The migration section below gives the rule.

### The audit reports the declaration source

A finding states whether the application declared the exception or whether a
framework helper declared it. The audit gives the file that holds the
declaration. A helper such as `webhook.hmac()` names itself as the source.

An application reads the audit and finds every exception, including the
exceptions that a helper made on its behalf.

### One diagnostic code vocabulary

`SecurityAuditFinding.code` becomes a closed union. The build verifier and the
runtime audit share one code vocabulary.

A code string names one condition. The framework removes the duplicate meaning
of `access-declaration-missing`, `cors-invalid`, and
`security-header-render-failed`. The framework uses one string for the missing
document policy and removes the second name.

A consumer reads a code and learns the condition without reading the source
that produced it.

### The advanced Vite hatch stays open and states its risk

`unstable_viteConfig` becomes `unsafe_unstable_viteConfig`. The callback keeps
its current capability. An application still receives the resolved Vite
configuration and still returns a rewritten configuration.

The framework adds no check that its own plugins survived the rewrite. An
application that removes the framework plugins loses the server-only module
boundary and the client environment boundary. The application then owns those
boundaries.

The name states both properties. The interface has no compatibility guarantee
between versions, and a rewrite can remove a security boundary.

## Consequences

- An application that declares a security exception states a reason. The reason
  appears in the audit.
- The audit separates an application decision from a framework helper decision.
- A tool reads one code vocabulary across the build and the runtime.
- The advanced Vite hatch remains available. Its name states the risk.
- The framework keeps no global switch that disables unrelated checks.
- An application keeps direct use of a provider SDK where core adds no
  contract.

## Migration

- Add a `reason` to each `csp: false`, `csrf: false`, and raised `maxBodySize`
  declaration. The build fails until the declaration states a reason.
- Rename `unstable_viteConfig` to `unsafe_unstable_viteConfig`. The old name
  works and warns during one release.
- Read the finding code table in the documentation when a tool matches a code
  string. Two codes changed name.

## Open items

This decision does not settle the following. Issue #405 settles them.

- The version field of the inspection report.
- The meaning of the `unstable_` export prefix and the path out of it.
- The command surface for static inspection.
- The redaction rule for a secret value in a report.
