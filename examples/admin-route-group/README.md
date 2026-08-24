# Bring Your Own Authentication

This example keeps authentication and authorization in the application.
Demiurge manages only the session boundary.

`src/auth.server.ts` defines the application-owned `authenticate(request)`
function. It accepts the native web `Request` and returns a typed principal.
Replace it with an adapter for a credential verifier or an OIDC callback.
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

## Choose one authentication session owner

This example shows an authenticator that returns identity without owning a
session. Demiurge owns the local application session in this model.

Auth0, Okta, Passport, or an OIDC client can verify an identity first.
The callback then maps that identity to `Principal` and creates this session.
The provider still owns its authorization-server session and logout protocol.

Some authentication libraries already own the complete application session.
Examples include Auth.js, NextAuth.js, Better Auth, Clerk, and SuperTokens.
Do not copy their session into a second Demiurge authentication session.

For a session-owning library, middleware performs these actions:

1. It gives the request to the library.
2. It maps the verified user or claims to `Principal`.
3. It adds the principal to the typed route context.
4. It forwards all response headers that the library returns.

The library remains responsible for its routes, cookies, renewal, and logout.
Demiurge remains responsible for routing, context, policy, and rendering.

An application can also use both systems for different purposes.
For example, Auth.js can own authentication while Demiurge owns an anonymous
cart session. Use different cookie names and store namespaces in that case.
