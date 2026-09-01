# Demiurge Static Export

The framework command builds the browser assets, server routes, and static
production output.

```sh
pnpm build
pnpm preview
```

The preview applies the headers in `demiurge-static-manifest.json`. It shows the
security policy that a production host must apply.

The output includes `index.html`, `about/index.html`, both concrete dynamic
guide paths, `robots.txt`, `sitemap.xml`, and `404.html`.
`demiurge-static-manifest.json` records the response headers for every artifact.
A production host must apply those headers at the matching path. The manifest
keeps the static adapter independent of a provider configuration format.

Ordered `fileHeaderRules` cover the remaining Vite and `public/` files. Hashed
files are immutable. Other files must revalidate.

The example selects `vercelStatic()` in `demiurge.config.ts`. The build also emits
Vercel Build Output API artifacts under `.vercel/output`.

The example gives `site.webmanifest` a one-hour application cache rule. That
typed rule overrides the framework revalidation default.

The home page renders an `Image` with the static image loader. The build reads
the variant paths back out of the rendered document. It writes one resized
WebP file for each variant under `dist/_demiurge/image`. A static host serves
those files, so no rewrite rule and no application server is required.

The site declares Inter in `src/fonts.ts` and self-hosts it. The build reads
`fonts/inter-latin.woff2` and writes the font file and one `@font-face`
stylesheet under `dist/_demiurge/font`. The document declares both through
`links`, and `fontSources(fonts)` keeps `font-src` at `'self'`. Inter ships
under the SIL Open Font License, and `fonts/inter-latin.LICENSE.txt` carries
that license.

The home page includes structured data. Its exact SHA-256 hash appears in the
static CSP. The browser test verifies this policy in Chromium.

The adapter writes to a staging directory before it publishes HTML. It preserves
the Vite asset bundle. It removes stale pages from its previous manifest. The
build fails on redirects, render errors, response cookies, or unsafe output
paths. It also fails when CSP depends on a fixed nonce.
