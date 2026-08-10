# Demiurge Static Export

This example builds the browser assets and an SSR route bundle, then runs the
production static adapter to generate concrete HTML files.

```sh
pnpm build
pnpm preview
```

The output includes `index.html`, `about/index.html`, both concrete dynamic
guide paths, and `404.html`. `demiurge-static-manifest.json` records the response
headers for every artifact. A production host must apply those headers at the
matching path; writing them to a manifest keeps the static adapter independent
of any one provider's configuration format.

The adapter writes into a staging directory before publishing HTML, preserves
the Vite asset bundle, removes stale pages listed by its previous manifest, and
fails the build on redirects, render errors, response cookies, unsafe output
paths, or CSP that depends on a fixed nonce.
