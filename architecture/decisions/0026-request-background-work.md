# ADR 0026: Best-Effort Request Background Work

## Status

Accepted.

Tracking: [GitHub issue #251](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/251).

## Context

Node already registers promises through `waitUntil` and drains them during graceful shutdown.
Route work needs an explicit interface to that lifetime boundary.
Applications also need control of error reporting.

## Decision

A server configures `background` on its request handler.
The configuration supplies `waitUntil` and an application-owned `onError` callback.
Handler construction requires an adapter with the `backgroundLifetime` capability.
An unsupported adapter rejects this configuration before it accepts requests.

Configured server route contexts expose `background.run(task)`.
The method accepts a callback and registers its completion before the callback starts.
Schedule tasks before the handler returns its response.
A saved interface rejects new tasks after that point.
An unconfigured context has no background interface.
Applications must handle that absence explicitly when background work is required.

A background operation does not delay the response.
Its instrumentation span links to the scheduling context under ADR 0024.
Task failures reach the configured error callback.
Instrumentation failures do not change the response or the task result.

Node drains registered work within its graceful shutdown deadline.
A process failure or an expired deadline can prevent completion.
This interface provides no persistent storage, retries, delivery acknowledgment, or durable completion.
Applications use an external queue when work requires durable delivery.

## Consequences

Application routes can use the existing adapter lifetime without importing Node APIs.
Each deployment must explicitly configure the lifetime and error boundaries.
The generic edge and static adapters cannot accept this configuration.
