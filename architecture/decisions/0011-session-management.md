# ADR 0011: Session Management

## Status

Accepted.

## Context

Tracking: [GitHub issue #246](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/246)

Demiurge has secure cookie declarations, cookie parsing, CSRF protection, and
replaceable shared-store contracts.

Applications must currently assemble session identity, storage, rotation, and
expiration without a framework contract.

This gap can produce inconsistent fixation protection and unsafe behavior across
multiple application replicas.

Demiurge must provide secure session infrastructure without owning users,
credentials, authentication, roles, or authorization.

## Decision

### Ownership

Demiurge owns session transport, storage contracts, lifecycle rules, and secure
defaults.

The application owns authentication and authorization. It also owns the data
that it stores in a session.

An authentication library integrates through application middleware. The
library does not need a Demiurge identity-provider adapter.

Applications can use raw cookies or another session library. Session APIs are
an optional framework capability.

### Session identity and data

A server-side session has an opaque identifier and a serializable data object.
The identifier contains at least 256 bits of cryptographic randomness.

The browser cookie contains only the identifier and its integrity protection.
It does not contain server-side session data.

Cookie session implementations contain the serialized session record. Signed
cookies provide integrity. Encrypted cookies also provide confidentiality.

Session data uses a caller-supplied generic type. Core does not reserve fields
for a user, principal, role, or identity provider.

### Session record

`SessionRecord<TData>` contains these values:

- `id` is the current opaque session identifier.
- `data` is the application-owned serializable value.
- `createdAt` is the creation time in epoch milliseconds.
- `expiresAt` is the absolute expiration time in epoch milliseconds.
- `idleExpiresAt` is the optional idle expiration time in epoch milliseconds.
- `version` is the non-negative concurrency version.

A store does not return an expired record. It removes an expired record when
practical.

The manager treats a malformed record as unavailable. It does not send record
contents in a diagnostic.

### SessionStore contract

`SessionStore<TData>` defines these atomic operations:

- `create(record)` stores a new record only when its identifier is absent.
- `read(id, now)` returns one live record or `undefined`.
- `update(record, expectedVersion)` replaces the matching live version.
- `rotate(currentId, record, expectedVersion)` replaces one session identity.
- `destroy(id)` removes the current identity when it exists.

Create, update, and rotate return a discriminated result. The result reports
`stored`, `conflict`, or `unavailable` without exposing provider errors.

A successful update increments the version. A successful rotation creates a
new identifier and invalidates the old identifier in one logical operation.

Only one concurrent rotation from the same version can succeed. Each other
rotation reports a conflict.

The contract accepts an explicit namespace at store construction. A namespace
contains the application, environment, and schema version.

Store implementations isolate every operation by the complete namespace. A
store cannot use an implicit global namespace.

Provider clients remain application-supplied. Core does not create a network
client or read provider credentials.

### Manager contract

`createSessionManager(options)` binds one transport to one store. It returns
request-scoped session operations.

The manager reads the request cookie at most once. It loads the related record
through the configured store.

The request-scoped API supports these operations:

- `get()` returns the current live session or `undefined`.
- `create(data, options)` creates a new session and cookie.
- `update(data, options)` changes the current session data.
- `rotate(options)` changes the identifier and preserves the data by default.
- `destroy()` removes the record and expires the cookie.
- `commit()` returns the required `Set-Cookie` header values.

Lifecycle operations fail closed after a store conflict or unavailable result.
The manager does not emit a new cookie for a failed operation.

The manager does not mutate a response automatically. The application adds the
returned headers to its response.

This rule keeps middleware, routes, redirects, and custom authentication
libraries interoperable.

### Expiration defaults

The default absolute lifetime is seven days. The default idle lifetime is 24
hours.

The absolute expiration never moves. A valid access can extend idle expiration
without exceeding absolute expiration.

The manager rotates a session after authentication privilege changes. The
application calls `rotate()` after login, logout, or a privilege elevation.

The default renewal threshold is one quarter of the idle lifetime. The manager
does not write on every request.

An application can configure shorter lifetimes. It can disable idle expiration
with the named `idleExpiration: false` option.

An application can disable automatic renewal with the named `renewal: false`
option. Absolute expiration cannot be disabled.

### Fixation and replay protection

The manager creates identifiers with a cryptographically secure random source.
An application cannot supply a session identifier.

Rotation invalidates the previous identifier before the manager emits the new
cookie. A store cannot implement rotation as an uncoordinated read and write.

The manager binds stored sessions to one configured cookie name and namespace.
It rejects an identifier that does not use the specified encoding and length.

Server-side logout destroys the stored record. A copied identifier cannot load
that record after logout.

Cookie sessions cannot revoke a copied cookie before expiration. Their public
options and documentation state this replay limit.

Applications that require immediate revocation use a server-side store. They
can also keep a separate application-owned revocation signal.

### Cookie transport defaults

The default session cookie uses `__Host-` scope, `Secure`, `HttpOnly`,
`SameSite=Lax`, and `Path=/`.

The cookie expiration does not exceed the record absolute expiration. Session
destruction emits the same cookie identity with an immediate expiration.

An application uses existing secure cookie options for a named transport
change. Cookie validation rejects an unsafe prefix or an oversized value.

`SameSite=None`, a shared domain, JavaScript access, or insecure transport is a
visible opt-out in application source.

### Signed and encrypted cookie sessions

Cookie session keys have stable identifiers. The first configured key signs or
encrypts new values.

The reader accepts configured previous keys. A successful read with a previous
key causes a commit with the current key.

Signed cookies use HMAC-SHA-256. Encrypted cookies use AES-256-GCM with a unique
96-bit nonce for each value.

Key material must contain at least 256 bits. Core accepts explicit key material
and does not derive it from a short password.

Authentication failure, unsupported versions, malformed data, and expired data
all produce an unavailable session.

The parser does not reveal which validation failed. The manager expires an
invalid cookie on the next commit.

### Static output

Static generation has no request-specific session authority. Static routes
cannot read, create, update, rotate, or destroy a session.

The static build rejects a route that declares a session dependency. It does
not generate one user's state into shared output.

Static pages can contain login links and unauthenticated content. Runtime APIs
can still set sessions after deployment on a separate dynamic origin.

### Multi-replica behavior

A memory store is process-local. Its public name and documentation identify
this limit.

A multi-replica deployment uses a shared conforming store. Redis and KV
integrations state their consistency and atomicity requirements.

The manager does not infer deployment topology. Adapter configuration and
deployment documentation identify when a process-local store is unsafe.

A provider without atomic rotation cannot claim full SessionStore conformance.
Its integration fails during construction or uses a provider-specific atomic
primitive.

### Custom library interoperability

Middleware can read a session before it calls an authentication library. It
can add the resulting application principal to typed request context.

The authentication library can update or rotate the session through the
request-scoped manager. It can also ignore the manager and use raw cookies.

Authorization remains route policy or application middleware. Session presence
does not grant authorization.

Authenticated responses declare private or disabled shared caching. The
framework does not infer cache policy from an application session field.

### Conformance and exports

Core exports the manager, memory store, cookie implementations, and their types
through documented package entry points.

A public testing entry point verifies lifecycle, conflicts, expiration,
rotation, and namespace isolation.

The same conformance suite runs against memory, Redis, KV, and custom stores.
Packed-consumer tests compile each public contract.

## Consequences

Applications receive one replaceable session lifecycle without receiving a
framework identity model.

Server-side stores support immediate revocation and atomic rotation. Cookie
sessions provide a deployment-independent option with a documented replay limit.

Shared deployments must select a conforming shared store. Static output cannot
contain request-specific session state.

Later implementation issues can test each transport and store against one
accepted contract.
