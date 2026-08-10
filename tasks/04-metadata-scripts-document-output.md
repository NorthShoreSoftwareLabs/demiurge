# Metadata Scripts And Document Output

Tracking: #6

## Goal

Document output should be typed, secure, and composable across layouts and leaf
routes, including scripts that may be statically declared or render-discovered.

## Features To Implement

- `defineMetadata` with required nudges for title, description, canonical, and
  social defaults.
- Cascading metadata merge from root layout to leaf route.
- Custom `meta(...)`, `link(...)`, structured data, sitemap, and robots helpers.
- `defineScripts` for static script contributions.
- Managed `<Script />` for render-discovered conditional scripts.
- Script placement and loading strategies: before interactive, after
  interactive, idle, module, worker where supported.
- Hoisting rules for scripts discovered during render.
- CSP diagnostics when a script cannot satisfy effective policy.
- Resource hints: preload, preconnect, modulepreload.

## Examples Required

- `examples/metadata-blog`
- `examples/conditional-script`
- `examples/analytics-scripts`

## Tests Required

- Unit tests for metadata/script merge.
- Type tests for required and custom metadata.
- Browser tests for conditional script loading.
- Security tests for CSP nonce/hash handling.

## Open Decisions

None open.

## Decisions Made

- Hoisting is a placement optimization, not a correctness mechanism (#39).
  Discovered before the head flushes, a script hoists. Discovered after, it
  renders where the component put it, which is correct because a browser runs a
  script wherever it finds one and because the origin was permitted by route
  policy before any HTML was sent. `beforeInteractive` is the exception: it
  promises timing rather than placement, and a late discovery cannot keep that
  promise anywhere in the document, so dev fails it and points at
  `export const scripts`. Non-streaming renderers assemble the whole document
  before sending, so they hoist everything and never reach the rule.
