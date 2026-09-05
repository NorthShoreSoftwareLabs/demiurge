# ADR 0017: Browser Data Disclosure

## Status

Accepted.

## Context

A page data function runs on the server. Its return value does not stay on the
server. The framework serializes that value into the initial document, and it
sends the same value again for a browser navigation.

A developer reads "this code runs on the server" as "this data is private".
The two statements are different. A loader that returns a database record sends
every column of that record to the browser.

The framework has no declaration that separates the value a loader reads from
the value a browser receives.

## Decision

An application declares the data that reaches the browser.

### The declaration

A route that returns data declares a projection. The projection is a typed
function, or an output schema that keeps Standard Schema interoperability. A
projection covers nested fields.

A route that returns no data declares nothing. There is no boundary to state.

An application that already returns a minimal public object declares that the
whole result is public. The declaration is explicit, and inspection output
reports it.

The build rejects a missing declaration where the build can detect it.

### The projected value is the only browser value

The result of the loader stays on the server. The framework serializes the
projected result.

The framework uses the projected result for the initial render, for hydration,
and for browser navigation. One value therefore reaches all three, and a
hydration mismatch cannot appear between a rendered document and a navigation
response.

### Mutations and errors

A mutation response uses the same contract. An error response uses the same
contract. A server error message and a session internal do not enter browser
diagnostics unless a projection selects them.

### Failure reporting

The framework reports a value that it cannot project or cannot serialize. The
report names the route and the field. The report does not contain the value.

### The framework does not guess

The framework does not infer sensitivity from a field name. A name such as
`token` or `secret` is a weak signal. It misses a sensitive field with an
ordinary name, and it gives false confidence.

The documentation states this limit.

A projection controls the serialized data of a route. It does not stop
application code that renders a secret into HTML. The documentation states this
limit as well.

## Consequences

The boundary between server execution and browser disclosure becomes explicit
and testable. A test can read an initial document, a navigation response, and a
mutation response, and it can prove that a nested secret does not appear.

Every existing route that returns data must declare its projection. The
migration is mechanical for a route that already returns a public object,
because that route declares the whole result as public.

The contract stays compatible with a future Flight payload, because the
decision names the serialization boundary rather than the transport.

An application keeps ownership of the shape of its data. The framework selects
nothing on its own.
