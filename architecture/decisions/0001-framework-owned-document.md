# ADR 0001: Framework-Owned Document

Status: accepted

Tracking: [GitHub issue #2](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/2)

## Context

Metadata, scripts, CSP nonces and hashes, hydration data, streaming, and route
fallbacks all meet in the HTML document. If an application owns `index.html`
and the React mount while the framework owns those features, two systems must
coordinate ordering and security-sensitive output.

## Decision

- Route files own addresses and capabilities.
- Application code owns layouts, pages, fallbacks, metadata, declared scripts,
  policy, and styles.
- Demiurge owns document creation, the client entry, and the React mount.
- Vite is the first build integration, not part of the application model.
- Page data and request-aware document contributions stay on the server during
  browser navigation.

Applications therefore do not provide `index.html` or a manual `src/main.tsx`.
The Vite integration generates the development document, browser entry, route
manifest, and production document output.

## Consequences

- Managed scripts, hydration data, structured data, and streaming payloads can
  all receive the request nonce from one renderer.
- Development, SSR, and static generation share document behavior.
- A page application must provide its root `@not-found.tsx`; the framework will
  not silently substitute branded markup.
- Adapters must declare whether they can provide document capabilities such as
  streaming, static headers, and nonce injection.
- Examples consume the generated document and built package, making the
  framework boundary part of normal verification.

## Verification

`examples/basic-blog` has no app-owned HTML entry or manual React mount. The
example builds, hydrates, navigates, and renders app-owned fallbacks through
`pnpm verify`.
