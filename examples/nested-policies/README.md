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
