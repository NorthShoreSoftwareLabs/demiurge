# Webhook Security Example

This production Node example demonstrates `webhook.hmac(...)` and the
raw-body constraint that makes HMAC verification correct.

`POST /api/webhook` reads the request body as raw bytes before verifying a
signature against those exact bytes. The handler never sees a parsed or
re-encoded body. It only sees the same `rawBody` the signature was checked
against. That ordering matters. The sender's signature covers the original
bytes. Verification must run against those same bytes, not a body that got
parsed, re-serialized, and handed to the handler in a different shape.

Run the example with:

```sh
pnpm build
pnpm start
```

Send a correctly signed request:

```sh
secret=demo-webhook-secret
body='{"event":"ping"}'
signature=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$secret" | sed 's/^.* //')

curl -i "http://127.0.0.1:4204/api/webhook" \
  -H "x-webhook-signature: sha256=$signature" \
  -d "$body"
```

A request with no signature header, or one that does not match the body,
receives a `401` before the handler runs.

## Why the raw body matters

A naive integration reads the request body as JSON first, since that is the
normal way to handle a POST route. It then re-serializes the parsed body to
check the signature. Re-serialized JSON can differ from the bytes the sender actually
sent. Key order, whitespace, and Unicode escaping can all change during a
parse-then-stringify round trip, which changes the signature and produces
false rejections for legitimate requests.

`webhook.hmac(...)` avoids that failure mode by reading `request.arrayBuffer()`
once, verifying the signature against those bytes, and only then exposing
`rawBody` and `text()` to the handler. The bytes checked and the bytes handed
to application code are always the same bytes.

`pnpm test:examples` runs an integration probe that sends a body containing
whitespace and characters a naive JSON round trip would mangle. It confirms
the signature still validates because the framework preserved the raw bytes,
and it confirms a bad signature is rejected.
