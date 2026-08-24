# ADR 0010: Route Mutation Protocol

## Status

Accepted.

## Context

Tracking: [GitHub issue #307](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/307)

Demiurge routes can use `action(...)` to parse input, run a handler, and
invalidate cache tags. The browser router can enhance forms and refresh route
data after a successful request.

React also uses the term Action for client functions. The shared term gives two
different framework boundaries one name.

The existing browser protocol has incomplete result and validation types. Its
refresh behavior also needs rules for redirects, failures, cancellation, and
concurrent submissions.

## Decision

### Names and public API

`mutation(...)` defines a server route mutation. A route exports the returned
capability under an unsafe HTTP method.

The supporting server API uses the `Mutation` prefix. The helper object is
`mutationInput`.

The browser result type is `MutationResult`. Browser submission state uses
`MutationNavigationState` until React form state replaces that compatibility
API.

The term React Action refers only to a React-compatible client function.
`createMutationAction(...)` creates that function from a typed route, method,
and path values.

The generated function sends `FormData` to the HTTP route. It returns a
`MutationResult` and accepts the signature that `useActionState` requires.

The browser bundle contains the route identity and input types. It does not
contain the server handler, security policy, or invalidation declaration.

### Migration before version 0.2.0

Version 0.2.0 is unreleased. Nightly builds have no compatibility promise.
Demiurge therefore removes the `action(...)` names without deprecated aliases.

Applications apply these direct replacements:

| Old name | New name |
| --- | --- |
| `action` | `mutation` |
| `actionInput` | `mutationInput` |
| `ActionContext` | `MutationContext` |
| `ActionIdempotency` | `MutationIdempotency` |
| `ActionInput` | `MutationInput` |
| `ActionOptions` | `MutationOptions` |
| `ActionRevalidation` | `MutationRevalidation` |
| `ActionValidationError` | `MutationValidationError` |
| `ActionValidationIssue` | `MutationValidationIssue` |
| `ActionResult` | `MutationResult` |
| `ActionNavigationState` | `MutationNavigationState` |

HTML `action` and `formAction` properties keep their platform names. React API
names such as `useActionState` also keep their names.

The mutation protocol uses mutation names for its public constants, request
header, and media type. The first released protocol version remains version 1.
No released client uses the earlier nightly identifiers.

### HTTP authority and progressive enhancement

The HTTP route is the authoritative mutation boundary. Native forms and direct
HTTP clients can call it without browser JavaScript.

An enhanced form keeps a real HTTP URL and native method. The browser enhancement
sends the same successful controls, submitter value, and encoding.

The browser enhances only a supported, same-origin, unsafe submission with the
`_self` target. Unsupported submissions keep native browser behavior.

The browser sends same-origin credentials. The mutation header selects a response
representation only. It does not grant trust or bypass a security check.

The server returns ordinary HTTP responses to native clients. It returns a
versioned `MutationResult` representation to an enhanced client.

### Result contract

`MutationResult` is a serializable discriminated union. It contains a version
and one of these statuses:

- `success` contains optional application data and the route refresh instruction.
- `invalid` contains typed field and form validation data.
- `redirect` contains a same-origin location and a history operation.
- `failed` represents an expected mutation failure without application data.

The framework rejects an unsupported serialized value. An unexpected exception
uses the existing route error and redaction contract.

A native validation failure uses the same validation data and an unsuccessful
HTTP status. An enhanced validation failure returns the equivalent `invalid`
result.

A raw application `Response` remains authoritative. Demiurge does not convert
its body into a structured application result.

### Invalidation, refresh, and redirect order

The server resolves declared invalidation only after the mutation commits
successfully. The browser cannot supply or change an invalidation declaration.

The server completes required invalidation before it completes the mutation
response. An invalidation failure uses the mutation failure path.

Cache invalidation and route refresh are separate operations. Invalidation
changes server authority. Refresh retrieves the current route authority.

A successful mutation refreshes the current route when its result requests
refresh. A validation or failed result does not refresh the route.

A redirect takes precedence over refresh. The browser navigates to the redirect
destination and does not refresh the previous route.

A redirect takes effect after required server invalidation completes. Permanent
redirects replace history. Other redirects push history.

The browser accepts an enhanced redirect only for the current origin and
protocol. A rejected redirect becomes a mutation failure.

### Cancellation and stale work

Each client function owns one current submission. A newer call cancels its
older request when possible.

Each enhanced form has an independent submission identity. An explicit key can
share that identity across replacement forms.

Navigation cancels pending enhanced submissions. A redirect cancels other
pending submissions before navigation starts.

Cancellation is advisory to the server. A cancelled request can still commit
its mutation. Applications use idempotency when duplicate commits are unsafe.

An obsolete response cannot update result state, start a refresh, or navigate.
A newer navigation or refresh response cannot be replaced by older route data.

### React ownership

React owns pending, optimistic, and component-local result state. Demiurge does
not create a second optimistic state system.

Demiurge owns transport, result validation, redirect handling, invalidation, and
authoritative route refresh. A React Action can compose these operations with
`useActionState`, `useFormStatus`, and `useOptimistic`.

React Server Functions use the same result and authority rules after the React
Server Components runtime exists. They do not replace HTTP route mutations.

### Security and idempotency

Mutations use the shared route security pipeline. Fetch Metadata, CSRF, CORS,
rate limits, body limits, and upload policy run before the handler where applicable.

The application owns a mutation security declaration. A client function cannot
weaken that declaration.

The application also owns an optional idempotency key, store, and lifetime.
Demiurge parses input before it resolves an input-dependent key.

An idempotent replay returns the stored response. It does not repeat the handler
or server invalidation.

### Adapter capabilities

A mutation requires the existing request and response pipeline. It adds no
mutation-specific adapter capability.

An adapter must support request bodies required by the selected input parser.
Existing body and upload validation reports an unsupported request.

Cache invalidation requires the configured cache contract. Idempotency requires
the store that the application supplies.

A multi-instance application must select shared stores when it needs shared
invalidation or idempotency. Demiurge does not infer that deployment requirement.

## Consequences

Server mutations and React Actions have distinct names and responsibilities.
Native and enhanced submissions use one HTTP authority boundary.

Redirect, refresh, invalidation, cancellation, and stale-response behavior have
one order. Later implementation issues can test each rule independently.

The unreleased rename has no compatibility alias. Packed-consumer tests must
compile the documented replacement names before version 0.2.0 ships.
