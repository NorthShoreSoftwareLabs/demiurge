# App-Owned Fallbacks

This production Node example shows that failure UI belongs to the application
and follows the route tree:

- root and `projects/` directories own separate `@loading.tsx`,
  `@not-found.tsx`, and `@error.tsx` files;
- `/missing` uses the root not-found component and root layout;
- `/projects/missing` uses the nearest project not-found component inside both
  inherited layouts;
- `/broken` and `/projects/broken` render the closest error component without
  running application layouts again;
- `/api/broken` returns a typed RFC 9457 `application/problem+json` response,
  never an HTML error page.

```sh
pnpm build
NODE_ENV=production pnpm start
```

The server defaults to `127.0.0.1:4193`. Follow the links from `/` to exercise
each state. Client navigation selects the nearest loading component while the
next route module is resolving.

From the repository root, `pnpm test:examples` starts the built server on an
ephemeral port and verifies status codes, content negotiation, nested fallback
selection, layout behavior, and production error redaction.
