# Configuration

Demiurge reads one configuration file. The file is `demiurge.config.ts` at the
root of the application. Demiurge generates the Vite configuration from it, so
an application does not write a Vite configuration file.

```ts
// demiurge.config.ts
import { defineConfig } from "@demiurgejs/core/config";

export default defineConfig({
  routing: { typedRoutes: true },
});
```

## Discovery

The project root is the directory that holds the `package.json` file of the
application. Demiurge resolves the root from the working directory of the
command, and it reads the configuration file from that root.

Demiurge accepts one file name at one location:

- It does not search parent directories.
- It does not accept another file extension.
- It does not accept a configuration subdirectory.

The file is required. There is no default configuration. Each command fails
when the file is absent. This includes `demiurge dev`, `demiurge build`, and
`demiurge preview`.

```text
demiurge: Demiurge did not find the configuration file /app/demiurge.config.ts.
  Every Demiurge command needs this file. There is no default configuration.
  Create an application with "npm create demiurge" to generate it.
```

Demiurge fails before it starts Vite when a value is invalid. The diagnostic
gives the file, the field path, and the value that the framework received.

```text
demiurge: Demiurge configuration is invalid.
  file: /app/demiurge.config.ts
  field: routing.routesDir
  problem: this option must be a string
  received: 42
```

## Boundaries

The configuration groups options by the part of the framework that reads them.

| Boundary | Options |
| --- | --- |
| `routing` | `locales`, `routesDir`, `typedRoutes` |
| `rendering` | `document`, `styles` |
| `security` | `staticFileHeaders` |
| `assets` | `fonts`, `images` |
| `deployment` | `outDir`, `server`, `static` |
| `env` | the environment schema |
| `devtools` | the route audit panel of the development server |

```ts
import { defineConfig } from "@demiurgejs/core/config";
import { vercelStatic } from "@demiurgejs/core/static";
import { fonts } from "./src/fonts";
import { locales } from "./src/localization";

export default defineConfig({
  assets: { fonts },
  deployment: {
    static: {
      origin: "https://example.test",
      provider: vercelStatic(),
    },
  },
  rendering: { document: { title: "Example" } },
  routing: { locales, typedRoutes: true },
});
```

`typedRoutes` writes the generated declarations to
`.demiurge/route-manifest.d.ts`. Add that file to the `include` array in
`tsconfig.json`. A TypeScript directory entry or broad glob does not enter a
directory that starts with a dot.

Give `typedRoutes` an `outputFile` value to select another path. Make the
`tsconfig.json` file include that path.

## Commands

`demiurge dev` starts the development server. `demiurge build` writes
production output. `demiurge preview` serves static output with its declared
headers.

`demiurge build` reads the `deployment` boundary:

- It always writes the client bundle to `deployment.outDir`. The default
  directory is `dist`.
- It builds the application server entry when `deployment.server` declares one.
- It writes static output when `deployment.static` exists.

```ts
export default defineConfig({
  deployment: {
    outDir: "dist/client",
    server: { entry: "src/server-entry.ts", outDir: "dist/server" },
  },
});
```

## Environment variables

The `env` boundary holds the environment schema of the application. The
framework validates the schema when the server starts, before the process
accepts traffic.

```ts
import { defineConfig } from "@demiurgejs/core/config";
import { defineEnvSchema, env } from "@demiurgejs/core";

export default defineConfig({
  env: defineEnvSchema({
    ANALYTICS_TOKEN: env.string({ optional: true }),
    DATABASE_URL: env.url(),
    PAYMENT_KEY: env.secret({ deferred: true, minLength: 32 }),
    SESSION_SECRET: env.secret({ minLength: 32 }),
  }),
});
```

A variable is required by default. A required value that is absent or invalid
stops the server start, before the process accepts traffic.

Two options give a variable a different lifetime. Declare exactly one of them,
or neither.

- `optional: true` permits absence. Demiurge validates a supplied optional
  value at startup, and stops the start when that value is invalid.
- `deferred: true` postpones validation to the first server access of the
  value. The access throws a clear error when the value is absent or invalid.
  Use it for a value that only one part of the application needs. An
  unrelated failure then does not stop every route.

Demiurge refuses a declaration that combines `optional` with `deferred`.

`env.secret(...)` marks a variable sensitive. A startup error, a deferred
access error, and the serialized schema description omit the value of a
sensitive variable.

### Migration from `critical`

Earlier releases declared a `critical` option. The default value was `false`,
so a required variable without `critical: true` gave a startup warning instead
of a startup failure. Demiurge removed that option.

- `critical: true` on a required value: remove the option. A required value
  now stops the start by default.
- `critical: false` on a required value: declare `deferred: true` instead. The
  value keeps its old behavior of not stopping the whole application at
  startup, and Demiurge validates it before the first read instead of never.

### The client boundary

A variable stays on the server. A variable that the schema declares with
`client: true` reaches the browser bundle, and the build inlines its value.

```ts
env: defineEnvSchema({
  PUBLIC_API_URL: env.url({ client: true }),
  SESSION_SECRET: env.secret({ minLength: 32 }),
});
```

The build inlines the value of a client variable, so the build validates the
value. A required client variable must have a value in the environment of the
build, and the build stops when that value is invalid. A client variable has
no deferred form, because the build validates the value before the server
starts. Demiurge refuses a declaration that combines `client` with `deferred`.

`env.secret(...)` refuses the `client` option. A secret variable never reaches
the browser. Read the value on the server, then send the result through route
data.

The build enforces this boundary. It walks the modules that the client entry
reaches. A module of that group fails the build when it reads a variable that
stays on the server. The diagnostic names the variable, the module, and the
import path:

```text
Demiurge stopped the build. Client code reads an environment variable that stays on the server.

  variable: SESSION_SECRET
  module: src/lib/session.ts
  import path: virtual:demiurge/client-entry -> src/routes/index.tsx -> src/lib/session.ts
  A secret variable never reaches the browser. Read the value on the server, then send the result through route data.
```

The build finds a name that the module reads. It does not find a value that a
dynamic key selects. Keep a module that reads a secret out of the client graph.
A module under `@middleware.ts` or `@policy.ts` is already out of that graph.

The schema declares what a variable is. Where the value comes from is a
separate concern. Demiurge reads the process environment.

The development server validates the same schema. `demiurge dev` starts the
environment before it serves the first request. A required variable that is
absent or invalid stops the start of the development server, and the command
exits with the diagnostic. Therefore, `readEnv` gives the same values in
development and in a build.

`readEnv` also gives the value of a deferred variable. Demiurge validates that
value on this first access, and every later access reads the cached result.

The generated server entry exports the validated values:

```js
import { env } from "./dist/server/server-entry.js";
```

An application that declares its schema in a separate module reads the same
values with `readEnv`:

```ts
import { readEnv } from "@demiurgejs/core";
import { schema } from "./src/env";

const { DATABASE_URL } = readEnv(schema);
```

Client code reads a client variable with the same function. Declare the client
variables in their own module, because a module that names a server variable
cannot enter the browser bundle:

```ts
import { readEnv } from "@demiurgejs/core";
import { clientSchema } from "./src/env-client";

const { PUBLIC_API_URL } = readEnv(clientSchema);
```

## Vite extension

Most applications do not configure Vite. Two tiers exist for the applications
that must.

The `vite` field is the supported surface. It accepts these merge points:

```ts
export default defineConfig({
  vite: {
    define: { __BUILD__: JSON.stringify("2026.1") },
    optimizeDeps: { include: ["lodash-es"] },
    plugins: [svgr()],
    resolve: { alias: { "~": "/src" } },
  },
});
```

Demiurge merges these values into the configuration that it generates. Another
key fails the build.

The `unstable_viteConfig` callback is the escape hatch. It receives the
resolved Vite configuration of the framework and returns a new one.

```ts
export default defineConfig({
  unstable_viteConfig: (config) => ({ ...config, logLevel: "silent" }),
});
```

This callback touches a framework internal. It has no compatibility guarantee
between Demiurge versions. Prefer the `vite` field.

## Related

- [ADR 0013](../../architecture/decisions/0013-framework-configuration-and-vite-boundary.md)
  records this decision.
- The [security guide](./security.md) describes the policy declarations that
  routes own.
