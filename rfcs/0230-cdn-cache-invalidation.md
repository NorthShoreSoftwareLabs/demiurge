# RFC 0230: CDN Cache Invalidation and Representation Controls

## Status

Accepted as [ADR 0027](../architecture/decisions/0027-response-cache-invalidation.md).

Tracking: [GitHub issue #230](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/230).
Provider investigation: [GitHub issue #481](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/481).

## Decision

Data invalidation and response-cache invalidation remain separate contracts.
Explicit Vercel response caching uses controlled public inputs, disposable fresh generation, and independent document and navigation publication.
Provider-managed stale serving requires explicit application consent.
Invalidation reports acknowledgment, rejection, or unknown acceptance without a global completion claim.

ADR 0027 defines eligibility, credentials, browser policy, failure handling, rollback, and implementation requirements.
The accepted decision incorporates the evidence constraints proposed in PR #487.
Public implementation requires its own verification issue.
The current public Vercel adapter retains uncached behavior.
