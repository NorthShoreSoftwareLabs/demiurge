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

## Enforcement Doctrine

Opinionated is not the same as rigid. Rigid means you cannot do the thing.
Opinionated means you have to say so out loud. Four rules follow from that, and
they decide what happens whenever an app does something the framework's defaults
disagree with:

1. Defaults are the strict option.
2. Relaxing a default is a named declaration at the route. `csrf: false` is a
   security audit you can run with `grep`. A config file three directories away
   is not.
3. Mistakes fail at the earliest moment they can be detected, preferring the
   build. The build is where the developer is present and no user is affected
   yet. Failing the request instead punishes the wrong person, and a warning
   that proceeds is a warning nobody reads by month three.
4. A control that can only fail inside a user's browser never defaults to
   breaking it. It defaults to reporting.

Rule 4 is the one that keeps the other three honest. Trusted Types enforcement
cannot be checked at build time, because a violation is a third-party library
assigning a string to `innerHTML` in a browser we do not control. Defaulting it
to enforce would not fail a build. It would fail a real session in production.
So the strict preset reports it, and enforcement is a named opt-in.

That is also why the strict preset is not being dishonest by declining to
enforce something in its own name. Strict promises the strongest policy that
cannot break a user at runtime.

Development is where rule 3 lands for runtime-only controls. Nothing can be
proven at build time about a browser sink, but a violation can be surfaced in
dev while the developer is still writing the code, which is the same goal one
step later.

Document contributions such as metadata, scripts, links, preloads, and styles
also belong to this pipeline. They should be collected, deduped, ordered, and
checked against the final security policy instead of being emitted as arbitrary
raw head markup.
