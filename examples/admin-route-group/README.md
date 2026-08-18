# Admin Route Group

This example shows the payoff of a parenthesized route group. `/dashboard`
and `/settings` live under `src/routes/(admin)` and share one
`@layout.tsx` shell and one `@middleware.ts` session gate. Both URLs stay
top-level, never `/admin/dashboard` or `/admin/settings`.

An unauthenticated request to either route redirects to `/login`, because
the group middleware runs before both routes and neither one repeats the
check. Log in from that page to set a demo session cookie, then both routes
render normally inside the shared admin shell.

Run the example with:

```sh
pnpm build
pnpm start
```

Then request `/dashboard` or `/settings` without a `session` cookie to see
the redirect, and with `session=1` to see the group's shared shell.
