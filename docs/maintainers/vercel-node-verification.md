# Vercel Node production verification

This record supplies the live provider evidence for [issue #411](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/411).
Authorized probes ran in the dedicated `demiurge-verification` project on October 28, 2026, UTC.
The fixture used synthetic data through published package exports and the shared request pipeline.

## Artifact and environment

Source commit: `a8a5bc144aeb2031f716e4eed482787f7373c74b`.
Artifact SHA-256: `746d61a689501ffb234e03292130b0f4b442bf0bb3ae4e955445451c8cd2ee52`.
The [evidence record](evidence/vercel-node-2026-10-28.json) contains source hashes, request results, response bodies, timing, and origin events.
Deployment: `demiurge-verification-24aqlzr9z-north-shore-software-labs.vercel.app`.

Build configuration selected `nodejs22.x`, region `iad1`, and a 60-second maximum duration.
Every observed function response reported Node `v22.23.2`.
The artifact enabled response streaming and request cancellation.
No response cache or external shared store was configured.

## Observed results

| Probe | Observed result |
| --- | --- |
| Repeated documents | Both responses returned 200 with distinct generation markers and CSP nonces. Each body contained its declared nonce. |
| Security headers | Documents retained CSP and `X-Content-Type-Options: nosniff`. |
| Runtime storage | Documents, navigation, and private controls retained `private, no-store`. Each provider cache result was `MISS`. |
| Navigation | The navigation request returned application JSON through the shared request pipeline. |
| Repeated cookies | Both distinct `Set-Cookie` fields retained their names and attributes. |
| Private controls | Each cookie identity received its own expected result. The record removes both private response bodies. |
| Request translation | The function retained the pathname and repeated query values. Vercel replaced the supplied synthetic client address. |
| Streaming | First byte arrived after 179 ms. Completion took 7,260 ms and delivered all eight expected chunks. |
| Response completion | The authenticated event collector recorded origin start and completion. |
| Cancellation | A client timeout stopped the stream after its first chunk. The collector then recorded the origin abort event. |
| Lifetime limits | The artifact reported no portable background lifetime. Startup rejected a request handler that requested unsupported background work. |

The saved-record assessment passed for all required observations.
The runner removed the temporary preview and stopped its event collector.
Production aliases did not change.
Cookie values, private bodies, and the operator public address are absent from the saved record.

## Reproduction

Build the published package and its consumer before live verification:

```sh
pnpm --filter @demiurgejs/core build
pnpm --filter @demiurge-examples/vercel-node build
node --import tsx tooling/vercel-node-live.ts --run
```

The live command requires authenticated Vercel CLI and ngrok access.
It permits only the dedicated verification project.
Assess the saved record without deployment:

```sh
node --import tsx tooling/vercel-node-live.ts --assess docs/maintainers/evidence/vercel-node-2026-10-28.json
```

Run the local fixture and assessment regression tests:

```sh
node --import tsx --test tooling/vercel-node-live.test.ts
```

## Limits

These observations cover one Node runtime, region, fixture, and invocation sequence.
They establish no process shutdown, durable background execution, shared-store consistency, or global propagation guarantee.
External queues remain responsible for durable work.
Shared stores require separate conformance evidence when an application uses multiple instances.

Vercel injected its preview feedback script into the document.
This HTTP probe does not establish browser compatibility for provider-injected scripts.
The record proves nonce correspondence for framework document content.
Browser hydration and response-cache behavior require their own verification.

See the [production guide](../guides/vercel-node-deployment.md) for supported application configuration and provider limits.
