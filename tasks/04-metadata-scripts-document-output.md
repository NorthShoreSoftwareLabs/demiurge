# Metadata Scripts And Document Output

Status: in progress

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

## Implemented Slices

- `defineMetadata(...)`, `meta(...)`, `link(...)`, and `resolveMetadata(...)`
  provide typed app-owned metadata objects with default charset and viewport.
- Page route loading resolves inherited layout metadata root-to-leaf, then leaf
  route metadata, including title defaults, title formatters, structured fields,
  Open Graph defaults, and custom metadata entries.

## Open Decisions

- Whether render-discovered scripts can always hoist to the document head or
  whether some strategies must stay near the rendered leaf.
