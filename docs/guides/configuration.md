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

`typedRoutes` writes the generated declarations to `route-manifest.d.ts` beside
the routes directory. The default file is `src/route-manifest.d.ts`. A
TypeScript `include` entry that covers `src` also covers the declarations, so
the application does not name the file. Give `typedRoutes` an `outputFile`
value to select another path, and make `tsconfig.json` reach that path.

An earlier version wrote the declarations to `.demiurge/route-manifest.d.ts`.
If `tsconfig.json` names that file in `files` or `include`, remove the entry.
The generator deletes the file, and TypeScript reports error TS6053 for a named
file that is not present.

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
    DATABASE_URL: env.url({ critical: true }),
    SESSION_SECRET: env.secret({ critical: true, minLength: 32 }),
  }),
});
```

Each variable has a `critical` option. The default value is `false`.

- `critical: true` stops the server start when the value is absent or invalid.
  Use it for a value that the whole application needs to start.
- `critical: false` lets the process start. Demiurge writes a startup warning
  that names the variable. A request that needs the value fails at the request
  path that reads it.

### The client boundary

A variable stays on the server. A variable that the schema declares with
`client: true` reaches the browser bundle, and the build inlines its value.

```ts
env: defineEnvSchema({
  PUBLIC_API_URL: env.url({ client: true }),
  SESSION_SECRET: env.secret({ critical: true, minLength: 32 }),
});
```

The build reads the value of a client variable one time. A client variable that
is critical must have a value in the environment of the build.

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
