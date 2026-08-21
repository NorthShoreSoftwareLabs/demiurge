# Nested Policies Example

This example shows a root document policy and a stricter policy for the
`/admin` route subtree.

The root policy permits `https://api.example.com` in `connect-src`. The admin
policy replaces that directive with `'self'` and sets `no-referrer`.

Run the example with:

```sh
pnpm build
pnpm start
```

Inspect the response headers for `/` and `/admin` to see the cascade.

## Route audit panel

The development server serves a route audit panel. Start the development
server:

```sh
pnpm dev
```

Open `http://localhost:5173/_demiurge/audit?path=/admin` in a browser. The
panel names the matched route file and the policy files that the route
inherits. It also shows the rendered headers, the document metadata, the
contributed scripts, and the cache reads. Change the `path` value to compare
`/` with `/admin`.

A production build and a static export do not contain the panel. See the
[devtools guide](../../docs/guides/devtools.md).
