# ADR 0013: Framework Configuration and Vite Integration Boundary

## Status

Accepted.

## Context

Tracking: [GitHub issue #318](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/318).
Related: [#211](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/211),
[#236](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/236), and the
encrypted environment file spike,
[#356](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/356).

Applications configure Demiurge today by calling the `demiurge(options)` Vite
plugin factory directly from `vite.config.ts`.
That factory lives in `packages/core/src/vite/plugin.ts` and accepts one flat
`DemiurgeVitePluginOptions` object (fonts, images, static deployment, locales,
typed routes, styles, devtools).
This approach exposes bundler plugin order and makes framework deployment
options look like Vite features.
They are actually framework contracts implemented on top of Vite.

Environment variable handling has a separate, related problem.
Applications read `process.env` directly with no type safety.
There is also no framework-enforced boundary between values safe for the
client bundle and values that must never leave the server.
A typed schema already exists in `packages/core/src/security/env.ts` with
builders for `defineEnvSchema`, `env.string`, `env.integer`, `env.boolean`,
`env.enum`, `env.url`, and `env.secret`, plus a `sensitive` flag per variable.
Nothing in the codebase wires this schema into the build or the client/server
boundary, and no application uses it.

## Decision

### Configuration file

`demiurge.config.ts` becomes the canonical application configuration file.
Standard applications no longer author `vite.config.ts` directly.
The framework generates the Vite configuration it needs from
`demiurge.config.ts`, keeping Vite a private implementation detail by default.
This follows the epic's existing decision rule.

### Configuration boundaries

`demiurge.config.ts` groups configuration by boundary (routing, rendering,
security, assets, deployment, environment) rather than one flat options
object. Existing plugin options (fonts, images, static deployment, locales,
typed routes, styles, devtools) carry over, reorganized under these named
boundaries.

### Environment configuration

`demiurge.config.ts` accepts an `env` field built from the existing
`defineEnvSchema`/`env.*` builders.
Applications can declare the schema inline in the config file or import it
from a separate module and assign it to `env`.
Both are supported since they produce the same schema value through the same
builders.
Neither approach is the framework's preferred style.

Each variable gains a `critical` option, default `false`:

- `critical: true` — a missing or invalid value fails server startup, before
  the process accepts traffic. Reserved for variables the whole application
  needs to boot (a database URL, a session secret) where no reasonable
  degraded mode exists.
- `critical: false` (default) — the process still boots. A missing required,
  non-critical variable is logged as a startup warning naming what is
  missing.
  The framework does not attempt to determine which routes it affects.
  Failure, if any, happens lazily at whichever request path actually uses the
  missing value.

A route-to-variable attribution feature (naming which routes a missing
variable would break) was considered and explicitly deferred.
It would need to reuse the module import-graph walk planned for server-only
boundary enforcement (issue #256).
That walk does not exist yet.
Even if it did, it would only catch statically-referenced variables, not ones
read through a dynamically-keyed lookup.
This feature is out of scope for this decision.

`env.secret(...)` variables are barred from client bundles by a hard
build-time failure when a client-reachable module references one.
This is not a naming convention like a `PUBLIC_`-style prefix.
A variable meant for the client is declared as a non-secret variable and
explicitly exposed to client code.
It is never marked `secret` and then leaked through an escape hatch.

The schema defines what a variable is: its type, optionality, criticality,
and sensitivity.
Where its value comes from (a `.env` file, a secret manager, an encrypted
file) is a separate, pluggable loader concern underneath the schema.
That sourcing concern is not part of this decision.
The encrypted-file workflow specifically is tracked in the spike at #356.

### Vite extension point

The framework offers two tiers, not one:

1. **Supported surface.** A narrow `vite` field in `demiurge.config.ts`
   exposing only known-safe merge points: additional `plugins`, `resolve.alias`,
   `optimizeDeps`, and `define`. The framework merges these into the Vite
   configuration it generates. This is the documented, recommended path and
   keeps Vite hidden for the applications that use it.
2. **Escape hatch.** An additional, explicitly unsupported callback receives
   the fully resolved Vite `UserConfig` and can return a modified version.
   This covers cases the supported surface does not handle.
   This tier is documented as touching a framework internal with no
   compatibility guarantee across Demiurge versions.
   It mirrors the tradeoff Next.js makes with its `webpack(config)` escape
   hatch.
   This escape is named and framed so it is never mistaken for a first-class,
   stable API.

### Adoption

Demiurge has no external users at `0.2.0-beta`.
The framework replaces the `vite.config.ts` plugin call with
`demiurge.config.ts` in one change.
There is no deprecation window, no codemod, and no period when the framework
accepts both forms.

The `demiurge(options)` factory in `packages/core/src/vite/plugin.ts` becomes a
framework internal.
It stops being an application-facing API.
The implementation work changes the repository examples and the
`create-demiurge` templates in the same change.

### Configuration discovery and diagnostics

The framework reads `demiurge.config.ts` from the project root.
The project root is the directory that contains `package.json` for the
application.
The framework resolves the root from the working directory of the command.

The framework accepts one file name at one location.
It does not search parent directories.
It does not accept another file extension or a configuration subdirectory.
One accepted name gives one accurate diagnostic when the file is absent.

The configuration file is required.
Each framework command fails when the file is absent.
This includes the development server, the build, the production start, and the
static commands.
There is no implicit default configuration.
The diagnostic gives the absolute path that the framework expects.
It also tells the user to create an application with `npm create demiurge`.

`create-demiurge` writes `demiurge.config.ts` in each template.
The templates stop shipping `vite.config.ts`.
The scaffolding command is the supported way to start an application.

The framework fails before it starts Vite when the configuration is invalid.
A configuration is invalid when the module throws an error.
It is also invalid when the module has no default export.
It is also invalid when a field does not agree with the configuration schema.
The diagnostic gives the file, the field path, and the value that the framework
received.

### Failure behavior

Consistent with the epic's existing decision rule, invalid configuration —
including a failed environment schema validation for a critical variable —
fails the build or fails startup. It is never allowed to reach a request
handler in a broken state.

## Consequences

Vite implementation details (plugin order, generated build entries) stop
being part of the application-facing configuration surface for the common
case. Advanced applications retain a path to real Vite configuration, at the
explicit cost of an unsupported-internals warning rather than a supported
contract.

Environment variables gain type safety and a schema-declared client/server
boundary enforced at build time.
This replaces an unenforced naming convention.
Startup failure is opt-in per variable rather than all-or-nothing.
A missing key for one optional feature does not take down an application that
does not need it yet.

Value sourcing for environment variables (files, secret managers, encrypted
blobs) stays a separate, replaceable concern from the schema itself.
Adopting an encrypted-file workflow later does not require revisiting this
decision.

A required configuration file makes the framework entry point explicit.
The framework does not have to infer configuration from the file system.
The cost is that a manually assembled project does not run until the file
exists.
`create-demiurge` covers that path, so the scaffolding command becomes part of
the supported first-run experience.

A direct cutover is only possible before the first stable release.
The framework accepts the churn now to avoid a permanent second configuration
form.
