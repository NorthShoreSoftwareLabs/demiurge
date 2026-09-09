# ADR 0019: Versioned Inspection and Diagnostic Interfaces

## Status

Accepted.

## Context

Issue #395 asks that a developer or an agent inspects a framework decision
without reading framework source. Issue #405 asks which interface carries that
promise.

A survey of `main` found the following.

- Two reports describe a route. `createSecurityAudit(...)` builds the runtime
  audit. `createRouteAudit(...)` builds the route report that the development
  server serves at `/_demiurge/audit`.
- No report states a version. A consumer reads `JSON.stringify(report)` and
  learns nothing about the shape that produced it.
- The mutation protocol already states `version: 1` in its reply. The
  repository therefore has one precedent for a versioned reply.
- The functions that build a report carry the `unstable_` prefix. The types
  that describe the same report carry no prefix. No document states what the
  prefix promises.
- Commit `b589ede` added a second prefix. `unsafe_unstable_viteConfig` states
  that a caller accepts a risk. The repository now has two prefixes and no
  definition for either one.
- No command reads a report. Each path is a Vite hook or an HTTP endpoint of
  the development server. A build stops or completes, and that behavior is the
  only exit code contract.
- No code removes a secret value before a report reaches its output.
- A report states a fact that the build knows and a fact that only a request
  supplies. The report marks neither one.

## Decision

### A report states an integer version

Each report type states a `version` field that holds an integer. The framework
raises the integer when it removes a field or changes the meaning of a field.
The framework does not raise the integer when it adds a field.

The mutation protocol already uses this form. One vocabulary is easier to read
than two.

Each report type carries its own version. The route report, the static policy
report, and the problem document version separately, because each one changes
for its own reason.

### The export prefixes have one meaning each

The repository uses three levels.

- A name without a prefix is stable. The framework changes it under the
  semantic version policy of the package.
- The `unstable_` prefix states that the shape can change in any release. A
  consumer accepts that risk.
- The `unsafe_` prefix states that use of the export moves a framework
  guarantee to the application. The shape can still be stable.

The two prefixes describe different properties, so one name can hold both. The
name `unsafe_unstable_viteConfig` states that the shape can change and that a
caller accepts a boundary.

A name leaves the `unstable_` prefix when it meets three conditions. An
accepted ADR describes the interface. The report of the interface states a
version. A packed-consumer test covers the interface.

The `unsafe_` prefix does not describe maturity, so a name never leaves it.

A type and the function that returns it carry the same prefix. The current
split, where `unstable_createRouteAudit` returns a plain `RouteAudit`, ends.

### One command reads the static report

The framework adds a `demiurge inspect` command. The command reads the route
tree, resolves the policy cascade, and writes one JSON document to standard
output. The command writes a human summary to standard error, so a pipe
receives the JSON alone.

The command reuses `verifyRoutePolicies`. A separate static pass would give a
second answer for one question.

The command uses these exit codes.

- `0` states that the report holds no finding with error severity.
- `1` states that the report holds at least one finding with error severity.
- `2` states that the command received an invalid argument, or that the
  framework could not read the configuration.

The development server keeps the `/_demiurge/audit` endpoint. The endpoint
answers for one request, and the command answers for the build. The two paths
call the same functions.

### A report marks a static fact and a request fact

Each section of a report states a `resolution` field. The value `static` states
that the build knows the fact. The value `request` states that only a request
supplies the fact.

An agent reads the field and learns which answer a build gives and which
answer needs a running application.

### The framework removes a secret value at serialization

One function serializes a report. That function removes a secret value, and no
other code repeats the rule.

A value is secret when one of these statements is true.

- An environment declaration created the value through `env.secret(...)`.
- A session record holds the value.
- A cookie holds the value.

The report states the name of the removed value and the reason. The report does
not state the value itself.

## Consequences

- A consumer reads a version and learns whether it can parse a report.
- A reader learns what a prefix promises, and an export has a path out of
  `unstable_`.
- A pipeline runs one command and reads a deterministic exit code.
- An agent separates a build fact from a request fact.
- A report carries no secret value.
- The framework keeps one implementation for the command and the endpoint.

## Migration

- Read the `version` field before parsing a report.
- Rename an import of `RouteAudit` to `unstable_RouteAudit`. The type now
  carries the prefix of the function that returns it.
- Replace a script that parses build output with `demiurge inspect`.

## Open items

- Issue #406 implements this decision.
- Issue #407 verifies the command against an agent workflow.
