# Agent Application Workflow

Use this workflow to create and verify an application without prompts. Select
the `create-demiurge` version that matches the required core package version.

```sh
npm create demiurge@<version> agent-app -- --template page --non-interactive
cd agent-app
pnpm install
```

The scaffold writes the same core version into `package.json`. The install
command can run dependency lifecycle scripts. If you do not trust the
dependency source, review the lockfile before installation.

The page template contains these application contracts:

- `src/routes/index.tsx` declares a page route.
- `src/routes/messages.ts` validates mutation input before its handler runs.
- `src/routes/@middleware.ts` resolves an authentication value.
- `src/routes/account/@policy.ts` protects the account route.
- `tests/application.test.ts` uses the public application test boundary.
- `demiurge.config.ts` selects the managed Node build.

## Verify the application

Run each command from the generated application directory:

```sh
pnpm test
pnpm typecheck
pnpm inspect
pnpm build
```

`pnpm test` imports route modules and executes application handlers. The test
also executes the authorization function and middleware.

`pnpm typecheck` does not execute application code. `pnpm inspect` executes the
configuration module, but it does not load route modules. `pnpm build` imports
configuration and route modules during the build. It does not call mutation
handlers.

## Start the managed Node process

Set an explicit host policy before the production process starts:

```sh
ALLOWED_HOSTS=127.0.0.1 HOST=127.0.0.1 PORT=3000 pnpm start
```

`pnpm start` executes the built application code and accepts requests. Send a
request to `http://127.0.0.1:3000/.well-known/ready` to check readiness.

## Check repair guidance

Delete the `access` field from `src/routes/@policy.ts`. Then run this command:

```sh
pnpm inspect
```

The command exits with status `1`. Its JSON report includes the stable
`access-declaration-missing` code, the affected route, and repair guidance.
Restore `access: { public: true }` before the application builds or starts.
