# Bring Your Own Authentication

This example keeps authentication and authorization in the application.
Demiurge manages only the session boundary.

`src/auth.server.ts` defines the application-owned `authenticate` function.
Replace that function with an adapter for any authentication library.
Demiurge does not provide an identity-provider API.

`src/session.server.ts` configures a `SessionManager` and a store.
The in-memory store is suitable only for this single-process example.
Use a shared `SessionStore` when multiple application replicas handle requests.

The `(admin)` group middleware performs these actions:

1. It opens the session.
2. It redirects a request that has no authenticated principal.
3. It adds the typed principal and session to the request context.
4. It commits session renewal after the route responds.

The settings route calls the application-owned authorization policy.
The route does not ask Demiurge to interpret roles or permissions.

Authenticated responses use `Cache-Control: private, no-store`.
This rule prevents a shared cache from storing principal-specific HTML or data.
The session store is the authority for logout and session rotation.

Run the example with:

```sh
pnpm build
pnpm start
```

Then request `/dashboard` or `/settings` to see the authentication redirect.
Use `operator` and `demiurge-demo` on the login page.

The committed key is for this example only.
Load session keys from a secret manager in a deployed application.
