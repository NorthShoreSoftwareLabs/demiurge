# ADR 0017: Browser Data Disclosure

## Status

Accepted.

## Context

A page data function runs on the server. Its return value does not stay on the
server. The framework serializes that value into the initial document, and it
sends the same value again for a browser navigation.

A developer reads "this code runs on the server" as "this data is private".
The two statements are different. A loader that returns a database record
sends every column of that record to the browser.

An earlier form of this record required a separate projection for each route
that returns data. The implementation of that form showed that a projection
adds no capability.

- The framework applies the projection in `loadPageRoute`, and it discards the
  value that the data function returned. No other code reads that value.
- The view renders on the server and in the browser. Therefore the data
  function must return each value that the view uses, and each value that the
  view uses must reach the browser.

The server value and the browser value are the same set. A projection is
therefore a transform that the data function can contain.

The defect is real, but it is a problem of the mental model. A second
declaration does not correct a mental model, and it adds a step to each route
that returns data.

## Decision

The return value of a page data function is the browser payload. The framework
adds no separate disclosure declaration.

- `data` states the contract. The framework serializes what `data` returns.
- The framework uses one value for the initial render, for the hydration
  payload, and for a browser navigation.
- A mutation result and an error response follow the same rule.

An application that must keep a value on the server returns a smaller value
from `data`.

The framework does not add a projection declaration, a public data
declaration, or a browser value type parameter. The framework does not fail a
build for an absent disclosure declaration.

### What the framework does supply

The documentation states the contract. The routes reference and the security
guide state that server execution does not make the returned data private.

The framework reports a value that it cannot serialize. The report names the
route and the field path. The report does not contain the value.

The framework does not infer sensitivity from a field name. A name such as
`token` is a weak signal. It misses a sensitive field with an ordinary name,
and it gives false confidence.

A test suite proves the contract. The tests read the initial document, a
navigation response, and a mutation response, and they assert on the raw
serialized text.

## Consequences

An application declares its browser payload in one place, which is the return
statement of `data`. There is no second declaration to keep in agreement with
the first.

The framework has no static check for an absent declaration. Such a check is
shallow. It proves that a property is present, and it cannot prove that a
projection removes a sensitive field. A projection of `(value) => value`
satisfies it.

The framework keeps the guarantee that matters, because one value reaches the
initial render, hydration, and navigation. A hydration mismatch cannot appear
between a rendered document and a navigation response.

`page(...)` keeps its type parameters in their current order. A browser value
parameter before the request-context values would change what an existing
third type argument names. The compiler would report no error.

The responsibility for the content of a browser payload stays with the
application, in the same place as every other return value.

The contract stays compatible with a future Flight payload, because this
record names the serialization boundary rather than the transport.
