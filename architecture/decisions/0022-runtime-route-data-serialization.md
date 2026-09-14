# ADR 0022: Runtime route-data serialization verification

## Status

Accepted and prepared on main for 0.2.0.

## Context

A page `data` function returns the browser payload. The framework serializes
that value into the document, the hydration payload, and navigation responses.

A candidate static contract is a recursive `Serializable` type:

```ts
type Serializable =
  | null
  | boolean
  | number
  | string
  | Serializable[]
  | { [key: string]: Serializable };
```

That type rejects a known `bigint`, function, symbol, `undefined` value, class
instance, `Map`, and `Set`. It also rejects a value that `JSON.stringify`
accepts or changes. JSON omits an object property whose value is `undefined`.

The type cannot reject `any`, a type assertion, or a value that an external
service supplies at run time. It also cannot report the route and field of a
circular reference. Recursive TypeScript shapes can describe a cycle without
the cycle being visible to the type system.

Adding the type would add a return constraint to every `data` function. It
would require applications to transform values that the current transport
already accepts. The constraint would also change the type interface without
making the run-time boundary complete.

An application often declares a record with an `interface`. TypeScript does
not assign that interface to a recursive string index signature, even when
each declared property is `Serializable`. A constraint would require an index
signature, a type alias, or a cast. This limitation adds interface work without
improving runtime verification.

## Decision

The framework keeps the current inferred return type of `data`. It does not
export or require a `Serializable` type for route data.

Before the framework sends route data to the browser, it validates the value
at run time. The validation rejects a `bigint` and a circular reference. These
values cause `JSON.stringify` to fail.

The validation allows values that JSON accepts or changes. This includes
`undefined`, functions, symbol keys, non-finite numbers, and class instances.
The existing JSON transport defines the result for these values.

When validation finds a circular reference or a `bigint`, it reports the route
and field path. The report does not contain the value. This report lets an
application locate a cycle that static types cannot identify.

The framework applies one validation before the value reaches the document,
hydration payload, or navigation response.

## Consequences

No opt-in is required. Existing routes keep their inferred `data` return type.

An application that returns a `bigint` must convert it to a JSON value. An
application that returns a circular value must return an acyclic projection.

The runtime report can expose a route failure where a previous
`JSON.stringify` call failed later. This behavior is part of the 0.2.0 release
target.
