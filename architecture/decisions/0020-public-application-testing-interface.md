# ADR 0020: Public Application Testing Interface

## Status

Accepted.

## Context

Applications need fast tests for routes, middleware, policies, pages, and
actions. A test must use the production request pipeline. A test must also use
standard `Request` and `Response` values.

The root package already exports `createRequestHandler`. It creates the
production request pipeline from application route importers. An application
can call the returned handler in a test.

This call requires repeated request construction. It also gives no named
application testing boundary. The current `internal/testing` entry point
exports route-manifest and route-matching helpers. Those helpers expose
framework implementation details.

The package also exports adapter, deployment, data, and security conformance
helpers. These helpers verify an implementation of a framework contract. They
do not test an application request.

## Decision

### The package exports one application testing entry point

The package adds `@demiurgejs/core/testing`. This entry point is stable under
the package semantic version policy.

It exports `createApplicationTest`. The function accepts either a
`RequestHandler` or the options for `createRequestHandler`. The handler form is
the primitive form.

The function returns an object with `request`. The method accepts a `Request`,
a pathname, or a URL. A pathname creates a real `Request` with a documented
test origin. The method returns the production `Response` without conversion.

An application can create its own handler before it creates the test object.
This supports application handler composition without a second configuration
contract.

### The entry point has no runner dependency

The testing entry point has no dependency on Vitest, Jest, a mocking library,
or an assertion library. A consumer can use it with any runner that supports
standard asynchronous functions.

The entry point provides no mocks, fixtures, response snapshots, or assertion
helpers. A runner owns those services. The framework owns request execution.

### The entry point uses the production request pipeline

`request` sends its `Request` through `createRequestHandler` or through the
handler that the application supplied. It does not call route modules,
middleware, policy functions, or page renderers directly.

The contract covers direct document and resource requests. It also covers
negotiated navigation and action requests. The returned response therefore
keeps its status, headers, body, redirects, and problem representation.

### A built application remains a separate test boundary

The entry point does not build an application or start a process. Issue #273
owns tests that verify packed applications and running production output.

An application test can prove a route decision quickly. A production process
test proves build output, files, listener configuration, and deployment
behavior.

### Internal helpers remain internal

The framework does not support `@demiurgejs/core/internal/testing` for
applications. The following helpers remain internal framework-test helpers:

- `handleRequestWithManifest`
- `unstable_createRouteManifest`
- `unstable_findPageMatch`
- `unstable_findRouteMatch`
- `unstable_loadPageRoute`
- `unstable_loadRoute`

Issue #269 removes the `internal/testing` package export after it publishes the
supported application entry point. Framework tests can import the source
helpers through repository-local paths.

The existing adapter, deployment, data, and security testing entries remain
public conformance interfaces. They do not become application route helpers.

### Packed consumers prove the public contract

Issue #269 adds a packed-consumer test. The consumer imports
`@demiurgejs/core/testing`, creates an application test object, and reads a
real response.

The test uses no repository path alias. It proves the package export, the type
declaration, and the required peer dependencies.

## Consequences

- An application gets one stable request-testing entry point.
- A test runner remains an application choice.
- Test code exercises the same request pipeline as a server.
- Framework implementation helpers stay outside the application contract.
- A process test remains necessary for build and deployment behavior.

## Migration

Replace an application import from `@demiurgejs/core/internal/testing` with
`@demiurgejs/core/testing`. Create the request handler through the public root
export when an application needs custom composition.

## Open items

- Issue #269 implements the application test harness.
- Issue #270 adds document and security assertions.
- Issue #271 adds static-output application test utilities.

