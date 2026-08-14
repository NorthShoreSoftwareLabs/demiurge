# Demiurge Static Export

This example builds the browser assets and an SSR route bundle, then runs the
production static adapter to generate concrete HTML files.

```sh
pnpm build
pnpm preview
```

The output includes `index.html`, `about/index.html`, both concrete dynamic
guide paths, `robots.txt`, `sitemap.xml`, and `404.html`.
`demiurge-static-manifest.json` records the response headers for every artifact.
A production host must apply those headers at the matching path. The manifest
keeps the static adapter independent of a provider configuration format.

The home page includes structured data. Its exact SHA-256 hash appears in the
static CSP. The browser test verifies this policy in Chromium.

The adapter writes to a staging directory before it publishes HTML. It preserves
the Vite asset bundle. It removes stale pages from its previous manifest. The
build fails on redirects, render errors, response cookies, or unsafe output
paths. It also fails when CSP depends on a fixed nonce.
