# Isolated Vercel ISR proof

This record continues [issue #481](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/481).
The [earlier investigation](vercel-isr-investigation.md) records the rejected October 15 configuration.
This private candidate adds no public API and changes no application adapter.

## Candidate contract

Requests retain their public path and navigation header.
Provider routing adds a reserved representation query to each function destination.
Prerender configuration includes that query in its cache identity.
Each wrapper removes the query before framework generation.

An Edge Runtime guard validates the original request before cache lookup.
It rejects credentials, unsupported methods, invalid navigation markers, unknown query names, and repeated edition values.
Clients cannot supply the reserved representation query.
Every guard invocation adds a new response marker.
An unchanged generation marker with a changed guard marker distinguishes origin reuse from request validation.

Public generation uses a new disposable data store and removes untrusted request headers.
Private and nonce controls have no prerender configuration.
Routes that require other per-request origin behavior remain ineligible for this candidate.

## Evidence

Source commit: `6b1b2ec`.
The [request record](evidence/vercel-isr-2026-10-17.json) identifies the complete commit, source hashes, routing, artifact hashes, and deployment.
Functions reported Node `v22.23.2` in the `iad1` configuration.
Expiration was 10 seconds, with representation groups `481` and `482`.
Request times, redacted headers, response properties, and source events support the observations.

| Probe | Observed result |
| --- | --- |
| Both warming orders | HTML and JSON retain separate identities and cache hits. |
| Cache hits | Generation, body digest, CSP, and origin counter remain unchanged. Each guard marker changes. |
| Query and credential inputs | Cold and populated routes reject the tested malformed requests. |
| Timed expiration | A stale version 1 precedes fresh version 2. |
| Explicit revalidation | Both representations reach version 3. |
| Failed regeneration | Revalidation returns 500. A public request retains stale version 3. |
| Recovery | A later cache hit returns version 4. |
| Concurrent generation | HTML retains version 5. JSON retains version 6. |
| Lost acknowledgment | Origin generation starts before confirmation. The public response can retain version 5. An authenticated retry restores version 7. |
| Private and nonce controls | Private identities remain separate. Fresh body nonces match complete CSP sources. |

Run the live candidate only in the dedicated verification project:

```sh
node --import tsx tooling/vercel-isr-live.ts --run --isolated
```

Assess the saved record without deployment:

```sh
node --import tsx tooling/vercel-isr-live.ts --assess docs/maintainers/evidence/vercel-isr-2026-10-17.json
```

Both the live assessment and the saved-record assessment passed.
Missing observations and changed required values fail the assessment.
The original candidate remains available without `--isolated`.

## Limits

These probes establish the listed single-region observations.
They do not establish atomic publication, global propagation, deployment rollback, or an exact retry interval.
Mixed versions during concurrent generation require an explicit consistency contract.

Navigation responses retained `no-store` while the explicit prerender target returned cache hits.
That response header alone cannot establish an ISR storage exclusion.
Eligibility must prevent private and nonce-dependent responses from reaching prerender targets.
This candidate excludes those controls through artifact configuration and validates requests before cache lookup.

The fixture does not prove browser hydration, arbitrary application middleware, external data-store freshness, or arbitrary `Vary` behavior.
The harness implements no durable invalidation delivery.
A lost acknowledgment leaves acceptance unknown until separate observations establish the outcome.

All five temporary previews were removed after their probes.
Source tunnels stopped, and production aliases did not change.

This proof left issue #481 open for additional evidence.
The [October 28 completion proof](vercel-isr-completion-proof.md) supplies the later observations and accepted limits.

## Proposal follow-up

[RFC 0230](../../rfcs/0230-cdn-cache-invalidation.md#evidence-applied-to-this-proposal) applies these observations to the proposed response-cache contract.
The proposal retains independent representation versions and explicit provider-managed stale consent.
It also retains the missing freshness, publication exclusion, browser, and rollback checks.
The request guard validates deployment inputs only.
[ADR 0025](../../architecture/decisions/0025-host-middleware-integration-boundary.md) keeps application middleware in the shared route pipeline.
The guard does not establish an application middleware extension.
