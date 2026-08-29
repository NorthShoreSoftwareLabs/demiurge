# Localization

Demiurge coordinates locale identity across routes, documents, metadata, static
output, browser navigation, and framework caches.

The application owns translations and message loading. Core does not provide a
translation function or a message catalog format.

## Configure locales

Pass `locales` to the Vite plugin and the production request handler.

```ts
import { defineLocales } from "@demiurgejs/core";

export const locales = defineLocales({
  defaultLocale: "en",
  path: {
    labels: { ar: "ar", en: "en", fr: "fr" },
  },
  supportedLocales: ["en", "fr", "ar"],
  xDefault: "en",
});
```

The default locale has no prefix unless `prefixDefault` is `true`. A declared
alias redirects to its canonical label.

Use `domains` when each locale has a canonical host. Use `directions` only when
the application must override the direction derived from the language.

## Use the active locale

Pages, layouts, data functions, middleware, and metadata functions receive the
active `locale`. Message loading stays in application code.

The framework writes the locale to `html[lang]`. It writes the resolved text
direction to `html[dir]`.

Each localized page receives a self canonical link and one alternate link for
each supported locale. Set `xDefault` to add the explicit `x-default` link.

## Generate static output

Pass the same locale configuration to `generateStaticOutput`.

```ts
await generateStaticOutput({
  locales,
  origin: "https://www.example.com",
  outDir: "dist/static",
  routes,
});
```

The build calls each dynamic route `paths` function once for each target locale.
Read `locale` from the function context when localized slugs differ.

The build emits only the locales for its configured origin. Run one build for
each canonical host when the application uses locale domains.

The build rejects locale paths that map to the same portable output file.

## Cache localized data

The request cache adds the active locale to keys and tags. Applications must not
add this scope manually.

Set `locale: "neutral"` on a cache request only when its value is identical for
all supported locales.

Preference redirects use `Cache-Control: private, no-store`. They also vary on
`Accept-Language` and the configured preference cookie.

A CDN must cache canonical locale URLs. It must not cache a preference redirect
as a shared response.

The `examples/node-server` application uses i18next for message loading. Its
locale resolver remains separate from its route components.
