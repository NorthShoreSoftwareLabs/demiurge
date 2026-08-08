# Framework-Owned Document Runtime

Status: implemented

The app should not own `index.html`, a manual React root file, or the router
mount. Those are framework responsibilities because the document is where
metadata, scripts, strict CSP nonces/hashes, streaming, RSC bootstrapping, and
rendering mode coordination all meet.

## Decision

- Route files own addresses and capabilities.
- App code owns layouts, pages, route fallbacks, metadata, scripts, policies,
  and styles.
- Demiurge owns document creation, the client entry, and the React mount.
- Vite is an implementation detail for the first adapter, not the app model.

## MVP Slice

- Provide `virtual:demiurge/client-entry`.
- Generate the browser router from the app's `routes` folder.
- Auto-import app-owned styles when `src/styles.css` exists.
- Let apps configure the initial document title and language.
- Serve framework-generated HTML in Vite dev for page routes.
- Feed matched page route document contributions into Vite dev documents.
- Serve framework-generated HTML for browser navigation misses so client
  not-found routing can run.
- Build with the virtual client entry instead of an app-owned HTML entry.
- Emit framework-generated `index.html` during build.
- Remove `examples/basic-blog/index.html`.
- Remove `examples/basic-blog/src/main.tsx`.

## Future Work

- Replace document title config with route/layout metadata collection.
- Add inherited route fallback files such as `@loading.tsx`, `@not-found.tsx`,
  and `@error.tsx`.
- Add a strict CSP document renderer that can attach per-request nonces and
  build-time hashes.
- Hoist route/layout script declarations into the document when requested.
- Render resolved metadata, resource hints, and static scripts in the
  framework-owned document.
- Add SSR, streaming, static, and RSC document variants.
- Add adapter contracts for platforms that do not use Vite in production.

## Acceptance Criteria

- The example app runs and builds without an app-owned `index.html`.
- The example app runs and builds without an app-owned `src/main.tsx`.
- Page routes receive a framework document in dev.
- API/redirect/text/json routes continue to return HTTP responses directly.
- Generated route types still update from route files.
- `npm run verify` stays green with at least 80% coverage.
