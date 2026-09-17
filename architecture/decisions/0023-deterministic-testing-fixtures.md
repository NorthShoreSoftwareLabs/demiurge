# ADR 0023: Deterministic Testing Fixtures

## Status

Accepted.

## Context

Applications need repeatable requests and time-dependent store tests. The
application testing interface runs the production request pipeline. It does
not create a request with a method, body, or headers. It also has no clock.

The root package already exports local memory stores. Each store has a
different configuration path for time or shared entries. An application needs
a small, stable fixture interface without a runner dependency.

## Decision

`@demiurgejs/core/testing` exports `createTestRequest(...)` and
`createTestClock(...)`.

`createTestRequest(...)` returns a standard `Request`. A relative input uses
the application test origin. A caller passes a standard `RequestInit` value.

`createTestClock(...)` returns `now`, `set`, and `advance` methods. A caller
passes `now` to a store or manager that accepts a clock.

The root package remains the entry point for memory cache, idempotency, and
session stores. These stores are local fixtures. They do not declare shared
or distributed behavior.

The testing entry point does not add mocks, a runner dependency, a fake
network, or a fake browser API. This decision narrows the fixture exclusion
in ADR 0020 to these standard API helpers.

## Consequences

- An application can control time without a test-runner clock.
- A test can create a standard request with explicit Web API options.
- A test must not use a memory store to prove replica coordination.
