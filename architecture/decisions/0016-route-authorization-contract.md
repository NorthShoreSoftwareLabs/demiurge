# ADR 0016: Route Authorization Contract

## Status

Accepted.

## Context

Demiurge owns sessions, CSRF protection, and the request pipeline. It does not
own authorization. An application decides who can read a record and who can
change it.

Today an application enforces that decision in `defineMiddleware`. Middleware
is a general extension point, so nothing proves that a check ran before a data
loader or before a mutation effect. Nothing reports the check to the security
audit. A route that a developer believes is protected can answer a direct HTTP
request.

A hidden user interface control is not a protection. A browser navigation and a
direct request reach the same server entry point.

## Decision

The route policy cascade gains an access declaration. The declaration inherits
like `document` and `security`, so one file protects a subtree.

### The declaration is required

Every route requires an inherited access declaration. The declaration states
public access, or it supplies an authorization hook.

The build rejects a missing declaration where the build can detect it. Where
the build cannot detect it, the request pipeline denies access.

The scaffold writes an explicit public declaration for a public application, so
a new application states its intent rather than inheriting silence.

### Execution order

The framework runs authorization before these operations:

- A protected data loader.
- A read of a protected cache entry.
- A render.
- The effect of a mutation.

The framework applies the same authorization to a document request, to a
navigation data request, and to a direct mutation request. A route therefore
gives one answer to the same person through every entry point.

### Composition

A child declaration adds a restriction. The framework runs each inherited hook
from the root of the subtree to the route, and every hook must permit the
request.

An application that replaces an inherited protection declares an explicit
exception. The exception is typed, and inspection output reports it with its
source and its scope.

### Failure

An authorization hook that throws denies the request. An absent authentication
context denies the request. The framework never reads a denial as a permission.

A denied request receives the denial response that the declaration selects. A
denied request never receives a cached representation of protected data.

### The application keeps the permission model

The hook receives the request context. It returns a decision. The framework
does not supply roles, tenants, or a permission language.

A route-level check does not replace a record-level check. An application still
verifies that the person owns the record that the loader reads. The
documentation states this limit, because a route-level check cannot see the
identifier that a loader resolves.

## Consequences

An omitted authorization declaration becomes visible, and it denies rather than
permits. This closes the gap that the epic names.

Every existing application must declare access for its routes. A public
application adds one root declaration. The migration is small for a public
site, and it is deliberate for an application with protected routes.

The audit and inspection output can report the effective authorization of a
route. The declaration is part of the policy cascade, and not ordinary
middleware.

The framework does not choose a permission model, so an application keeps its
authentication provider and its record rules.

Middleware stays available. An application that needs work before
authorization, such as session resolution, keeps that work in middleware.
