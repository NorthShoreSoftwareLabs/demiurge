# ADR 0008: Declared Self-Hosted Fonts

## Status

Accepted.

## Context

Issue #67 records that `platform/fonts.ts` planned fonts that no part of the
framework served. It wrote `@font-face` text and preload links that no build
step emitted and no handler answered.

Self-hosting is the point of the module. A third-party font host is a `font-src`
entry, and it observes every visitor of the site. The framework already refuses
that trade elsewhere, so a font has to reach the browser from the application
origin.

ADR 0007 solved the same connection problem for images. An image variant path
describes its own transform, and the build reads those paths back out of the
rendered documents. Fonts cannot reuse that discovery step. A document
references a font through a stylesheet, and a stylesheet is not a document, so
document scanning would find nothing.

## Decision

A font set is a declaration rather than a render result. The application
declares it with `defineFonts` and passes the same value to the Vite plugin,
the way an image policy already travels. The build reads the declaration from
the plugin API and publishes every font in it.

The published URL derives from the declaration alone. `fontAssetUrl` names the
family, the weight, and the style, so the renderer and the build agree without
sharing state. That is the property ADR 0007 protects, reached by a different
route.

The build writes each font file and one `@font-face` stylesheet under
`/_demiurge/font`. A stylesheet file rather than an inline `style` element
keeps `style-src 'self'` intact.

`fontLinks` returns the stylesheet link and one preload for each font. It
returns plain `LinkTag` values, so a font uses the resource hint primitive that
`preload` already provides.

`font.local` names a project file. `font.google` names the font file URL, and
the build downloads it once into a cache directory. The framework reads no
third-party stylesheet, because that request is part of what self-hosting
removes.

`fontSources` derives the `font-src` value. A self-hosted set returns `'self'`
alone, and a font that keeps its host adds that origin.

## Consequences

The build publishes every declared font rather than only the fonts a page used.
A declaration is small and deliberate, so the waste is bounded, and a font that
only a stylesheet references still reaches the output.

A font URL is not content-addressed, so a replaced file keeps its URL. The
output therefore uses a revalidated cache policy, matching image variants.

`font.google` requires an explicit file URL. That is more work than naming a
family, and it is the honest cost of never contacting the font host at render
time.

No font component exists. A font governs the whole document rather than one
element, so `links` carries it and the public API gains no second spelling.
