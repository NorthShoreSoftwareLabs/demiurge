# Basic Blog Example

This fixture exercises browser routing, SSR document output, HTTP capabilities,
inherited route policy, and generated route types through the Vite adapter.

## Security Examples

`POST /api/health` intentionally omits a CSRF setting. A tokenless request with
no cookies succeeds. A request carrying cookies must also send matching
`csrf-token` cookie and `x-csrf-token` header values. This demonstrates the
framework default rather than an opt-in route setting.

`POST /api/webhook` uses `webhook.hmac(...)`. The helper verifies its signature
and explicitly exempts the capability from CSRF, including when the incoming
request happens to carry cookies.
