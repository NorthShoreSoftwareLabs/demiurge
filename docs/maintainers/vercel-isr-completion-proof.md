# Vercel ISR completion proof

This record supplies the bounded provider evidence for [issue #481](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/481).
Authorized probes ran in the dedicated `demiurge-verification` project on October 28, 2026, UTC.
[ADR 0027](../../architecture/decisions/0027-response-cache-invalidation.md) accepts the response-cache boundary supported by these observations.
The public adapter retains uncached behavior.

## Artifact and environment

Source commit: `f2d371c3ffb8952673864650583319a7dc50fd8f`.
Original artifact SHA-256: `96144843c8380ee8671fdb0c77ab721e95b1ab406db6dbee150a69d86b33df12`.
The [completed evidence](evidence/vercel-isr-2026-10-28.json) identifies both deployments, source hashes, routing, requests, source events, and cleanup.
Functions reported Node `v22.23.2` under `nodejs22.x` in `iad1`.
Public targets used a 10-second expiration and representation groups `481` and `482`.

A reserved provider query includes the representation and deployment namespace.
The wrapper removes that query before generation.
An Edge Runtime guard validates the original request before lookup.
Public generation removes untrusted headers and uses a disposable framework data store.
Private and nonce controls receive no prerender configuration.

## Observed results

| Probe | Observed result |
| --- | --- |
| Representation identity | Both warming orders retained distinct HTML and navigation JSON entries. Cache hits retained generation and body hashes. |
| Request validation | Cold and populated entries rejected tested credentials, unknown or duplicate queries, reserved identities, invalid navigation markers, and unsafe methods. |
| Direct function paths | Direct document and navigation target requests received 400 responses. |
| Required request behavior | Guard markers changed on cache hits. Origin generation markers remained unchanged. Per-request application middleware remains ineligible. |
| Timed freshness | Stale version 1 preceded fresh version 2. Page, layout metadata, route metadata, and document links each reached version 2. |
| Explicit freshness | Document and navigation reached version 3 with matching contribution versions. |
| Failed regeneration | Revalidation returned 500. A public request retained stale version 3. Later requests reached version 4. |
| Concurrent generation | Document retained page version 5 while navigation retained version 6. Contributions can observe later source reads within a generation. |
| Lost acknowledgment | The client timed out after origin work started. A retry reached version 7 without repeating application mutation work. |
| Browser behavior | Production React output hydrated, handled a button click, navigated from version 7 to version 8, and restored history. |
| Browser contributions | Title, layout description, and canonical link matched each observed page version after navigation and history restoration. |
| Deployment replacement | Explicit namespace changes eventually exposed the replacement artifact for both representations. Alias transitions temporarily retained original entries. |
| Rollback | The alias returned to the original artifact while replacement generation was pending. Later requests retained original artifact identity. |
| Old generation | Replacement version 10 completed after the alias returned. It remained observable through the replacement deployment. |
| Cleanup | Both temporary previews and the temporary alias were removed. Production aliases did not change. |

The completed saved-record assessment passed.
Each required observation must exist exactly once where the assessment requires a named result.
Changed versions, missing cleanup, false publication order, and representation collisions fail the assessment.

## Fresh generation and eligibility

Local probes preload stale ordinary-cache entries for page, layout, metadata, and document contributions.
Fresh generation reads updated values and deduplicates repeated reads without changing those ordinary entries.
Live probes independently read each contribution from the authenticated synthetic source.
These results establish the disposable framework-store rule.
External cache freshness remains application-owned.

Artifact inspection found exactly four public prerender targets.
Private and nonce targets had no prerender configuration.
Public asset scans found neither source nor provider credentials.
Local response-validator tests rejected cookies, private policy, nonce-dependent output, and unsupported variation before publication.
Live controls verified the recorded private identities, nonce correspondence, and request exclusions.
The live run did not inject every unsafe response class into regeneration.

The fixture uses generation counters to detect origin reuse.
Those counters do not authorize arbitrary application middleware on cached routes.
The first accepted contract rejects routes that require per-request application behavior or arbitrary header variation.

## Preserved failed observations

The [first browser attempt](evidence/vercel-isr-2026-10-28-browser-failure.json) timed out before hydration.
Its client used top-level `await` while a dynamic chunk imported entry exports.
Removing that evaluation cycle allowed the production bundle to hydrate.
Local production-bundle checks preceded the corrected live run.

The [navigation observation](evidence/vercel-isr-2026-10-28-navigation-observation.json) recorded document version 8 with navigation version 1.
The document acknowledgment did not establish navigation publication.
The corrected setup explicitly revalidated and observed both representations before the browser destination check.

The [alias observation](evidence/vercel-isr-2026-10-28-alias-observation.json) recorded a replacement document with an original navigation entry.
An alias change alone did not establish simultaneous representation replacement.
The corrected candidate adds explicit deployment namespace values to the provider cache identity.
It records intermediate alias responses while it observes the selected artifact.
These observations establish no fixed alias propagation period.

All preliminary previews were removed.
The records preserve their source commits and failed conditions.

## Reproduction

Build the package and consumer before live verification:

```sh
pnpm --filter @demiurgejs/core build
pnpm --filter @demiurge-examples/vercel-node build
node --import tsx tooling/vercel-isr-live.ts --run --isolated
```

The command requires authenticated Vercel CLI, ngrok, and Playwright Chromium access.
Use an ngrok version that your account accepts.
Only the dedicated verification project is permitted.
The runner removes its previews and temporary alias.
It stops the synthetic source tunnel after the probes.

Assess completed evidence without deployment:

```sh
node --import tsx tooling/vercel-isr-live.ts --assess docs/maintainers/evidence/vercel-isr-2026-10-28.json
```

The earlier failed records intentionally fail the completion assessment.
Historical October 17 evidence retains its original bounded assessment.

## Limits

The browser uses a `vercel-curl-bridge` to obtain protected provider responses.
That bridge forwards the navigation marker, removes transport encoding, and excludes preview toolbar injection.
It does not prove direct browser credential, cookie, CORS, or Fetch Metadata handling through deployment protection.
Separate HTTP probes supply the recorded hostile-request evidence.
The browser proves React behavior and document updates from the provider response bytes under that bridge.

These probes cover one region and a bounded route, query, and deployment matrix.
They establish no global cutover deadline, atomic publication, source snapshot, maximum stale age, or exact retry interval.
An alias can expose mixed releases during a transition.
Restoring an artifact does not restore an external data snapshot.
Immutable asset changes were outside this two-artifact fixture.
Public implementation requires separate production, browser, inspection, and packed-consumer verification.
