# ADR 0021: Typed cache-store atomicity capability

## Status

Accepted and prepared on main.

## Context

`CacheStore` implementations coordinate cache entries, tag membership, and
stale refresh leases. Redis keeps these related writes atomic with Lua scripts.
The memory store is atomic within its process. The KV store uses sequential
operations and cannot provide cross-key atomicity or compare-and-swap.

The shared cache contract proves operation shape and stale refresh behavior.
It does not prove a guarantee that a provider cannot provide.

## Decision

`CacheStore` declares a required `capabilities.atomicity` value. The type is
`"strong" | "best-effort"`.

Memory and Redis stores declare `strong`. The KV store declares `best-effort`.
The tiered store delegates the value to its source-of-truth `l2` store.

The cache conformance helper validates the declared value. The helper does not
claim that a best-effort store provides exclusive execution.

## Consequences

Applications can inspect the consistency guarantee before they select a store.
Existing custom stores must declare one value when they implement `CacheStore`.
The capability does not change cache behavior or upgrade KV consistency.
