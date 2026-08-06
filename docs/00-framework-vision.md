# Framework Vision

Demiurge is a React framework built from first principles. The goal is not to
clone an existing framework feature-for-feature. The goal is to make the
framework's primitives honest enough that pages, APIs, redirects, realtime
connections, streams, server rendering, and strict security policies all fit the
same mental model.

## Core Principles

1. A route file owns an address, not a page.
2. Route module exports declare capabilities at that address.
3. HTTP methods are entrypoints, not page markers.
4. Helpers describe what a handler produces.
5. React rendering is one possible HTTP result.
6. Security policy is a first-class runtime and build concern.
7. TypeScript should make invalid framework states hard to express.

## Route Shape

The filesystem maps files to addresses:

```txt
src/routes/index.ts
src/routes/posts/[id].ts
src/routes/api/search.ts
src/routes/realtime/chat.ts
```

Route modules then declare what can happen at that address:

```ts
export const GET = page(...)
export const POST = action(...)
export const WS = socket(...)
```

This keeps us away from the common "file equals page" assumption while still
keeping the filesystem useful.

Framework-attached files use `@` so ordinary names remain available to the app:

```txt
src/routes/@layout.tsx
src/routes/@policy.ts
src/routes/@middleware.ts
src/routes/policy.ts
```

Here, `@policy.ts` is inherited framework policy, while `policy.ts` is the real
`/policy` route.

## Rendering Philosophy

React rendering should be modeled as a set of traits instead of one exclusive
mode:

```ts
react({
  server: "none" | "ssr" | "rsc",
  hydrate: "none" | "page" | "islands",
  stream: true,
  prerender: false,
  render(ctx) {
    return <Page />;
  },
});
```

This matters because real apps combine concerns:

- A page can be prerendered and hydrated.
- SSR can stream.
- React Server Components can stream.
- A static document may still contain client islands.
- The CSP strategy may differ between static, dynamic, streaming, and RSC
  responses.

## Security Philosophy

Strict CSP should not be an afterthought. The framework should own enough of the
document pipeline to generate nonces, attach them to framework-managed scripts
and styles, serialize bootstrap data safely, stream React payloads without
inline-script escape hatches, and produce useful security headers by default.

Security should be configurable per app and per route, but the default preset
should be meaningfully strict.

Document contributions such as metadata, scripts, links, preloads, and styles
also belong to this pipeline. They should be collected, deduped, ordered, and
checked against the final security policy instead of being emitted as arbitrary
raw head markup.
