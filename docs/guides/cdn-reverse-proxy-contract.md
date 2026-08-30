# CDN and Reverse-Proxy Deployment Contract

A CDN or reverse proxy sits between clients and a Demiurge deployment. It can change request identity, response streaming, compression, caching, and security headers. Deployment guidance must make these changes explicit.

A rule below is a framework requirement when the adapter enforces or depends on
it. A setting is a proxy operator choice when the proxy decides the value and the
application only reads or reacts to it.

## Trusted proxy and forwarded-header handling

**Framework requirement.** The Node adapter ignores forwarded headers by default.
A process that trusts `X-Forwarded-For` from anyone has no client address at all.
For the proxy address to be valid, it must be a single trusted hop or match a
configured IP range. The adapter reads `X-Forwarded-For`, `X-Forwarded-Proto`,
and `X-Forwarded-Host` right-to-left through that boundary to resolve the real
client address, scheme, and host. Exactly one trusted hop in front of the process
calls for `trustProxy: { hops: 1 }`. A proxy fleet with stable addresses calls
for `trustProxy: { ranges: ["10.0.0.0/8"] }` instead.

**Proxy requirement.** The proxy must add these headers on every request:
- `X-Forwarded-For`: The real client IP address
- `X-Forwarded-Proto`: The request scheme before the proxy (`http` or `https`)
- `X-Forwarded-Host`: The original host header the client sent

If the proxy is the only hop between client and application, these headers must
be set for the first time (not appended). If other proxies sit between the client
and this proxy, the proxy must append to any existing `X-Forwarded-For` header
instead of overwriting it.

**Unsafe default.** Never enable proxy trust on a process that clients can also
reach directly. That direct reach makes the proxy bypassable, and a client can
forge forwarded headers without authentication.

## Host and scheme validation

**Framework requirement.** The adapter checks the request authority against
`allowedHosts` before the request becomes a Web `Request` URL. A forged `Host`
header never reaches route code or absolute-URL generation. The allowed hosts
are whatever the platform routes to the server, whether that is a `*.run.app`
domain, a custom domain, or an internal service name.

**Proxy requirement.** The proxy must not rewrite the `Host` header when
forwarding to the application. The application reads `Host` to validate the
authority. If the proxy changes it, host validation fails and the request is
rejected. For the application to see the original `Host` header, the proxy
operator must either:
- Keep the proxy and application on the same domain (no rewrite needed), or
- Explicitly configure the proxy not to rewrite the `Host` header in the upstream pass.

The application also uses `X-Forwarded-Host` (when a proxy is trusted) to confirm
the original domain matches an allowed host. The proxy must set this accurately,
and the application must be configured to expect it.

## Streaming, buffering, and timeouts

**Framework requirement.** The application streams responses when possible to
reduce time-to-first-byte and memory use. The response body is a Web
`ReadableStream` that the adapter pipes to the HTTP response. Buffering the
entire response into memory defeats this design and can exhaust resources on
large payloads.

**Proxy requirement.** Do not buffer the entire response before sending it to
the client. Stream it as it arrives from the upstream application. Most reverse
proxies do this by default, but some CDNs or caching layers may buffer.

**Timeout requirement.** Timeouts must be configured on both sides of the proxy:
- The proxy's upstream timeout (to the application) should exceed the
  application's maximum request time. The Node adapter defaults to five minutes.
- The application's read timeout (waiting for the proxy) should exceed the
  proxy's client timeout. This prevents the application from timing out while
  the proxy is still serving the client.

If the proxy times out before the application finishes, the proxy closes its
connection to the application. The application should detect this via the
`AbortSignal` on the request and stop unnecessary upstream work. Timeouts that
are too short on either side of the proxy can cause incomplete responses.

## Compression and content-length handling

**Framework requirement.** The application generates a `content-length` header
for responses it can measure in advance, such as static files. For streaming
responses where the size is unknown, the application uses `transfer-encoding:
chunked` instead. Both are valid HTTP/1.1 and HTTP/2.

**Proxy requirement.** If the proxy applies gzip or brotli compression to the
response, it must remove or recalculate `content-length`. Most reverse proxies
do this correctly. Misconfigured ones may leave a stale `content-length` that
does not match the compressed body, breaking clients. Use `transfer-encoding:
chunked` if you cannot recalculate content-length, or disable compression for
that response.

If the proxy applies compression, it must add `content-encoding: gzip` (or the
relevant encoding) so the client knows to decompress.

## Range requests and conditional requests

**Framework requirement.** The Node static handler supports byte-range requests
with `206 Partial Content` and conditional requests with `304 Not Modified` via
ETag and Last-Modified validators. Other routes do not advertise range support
and return 200 for non-conditional requests.

**Proxy requirement.** Do not rewrite or drop ETag and Last-Modified headers.
These validators identify the response for caching and conditional requests.
If the proxy modifies the response (such as by compressing), it should
recalculate or drop the ETag so clients do not use a stale validator.

Range requests require knowledge of the full content-length. If the proxy
streams the response without knowing the length in advance, it cannot answer
range requests. Do not forward range requests to the upstream application in
this case. Return a 416 Range Not Satisfiable or drop the `Range` header before
forwarding the request upstream.

## Repeated response headers and Set-Cookie

**Framework requirement.** The application may emit multiple `Set-Cookie` headers
on a single response. This is the only HTTP header that legitimately repeats.
The adapter ensures that each `Set-Cookie` value travels as a separate header,
not combined into one comma-separated value.

**Proxy requirement.** Preserve all `Set-Cookie` headers individually. Do not
combine multiple cookies into a single header. Most reverse proxies handle this
correctly by default, but some may incorrectly join repeated headers with a
comma. This breaks cookie parsing on the client side.

## Security and CORS header preservation

**Framework requirement.** The application sets security headers through the
`policy` API, including `Content-Security-Policy`, `X-Content-Type-Options`,
`Cross-Origin-Resource-Sharing` headers, and others. These headers are critical
to security and correctness.

**Proxy requirement.** Do not strip or modify security headers. In particular:
- Do not remove `Content-Security-Policy`, `X-Content-Type-Options`, or
  `X-Frame-Options` headers.
- Do not add `Access-Control-Allow-Origin` or other CORS headers unless the
  application explicitly set them. Proxies should not override CORS policy.
- Do not add or modify `Strict-Transport-Security` unless needed. HSTS should
  come from the application or the TLS termination layer, not the proxy.

If the proxy needs to add headers (such as for access logging or security), do
so without removing what the application set.

## Cache-key inputs and Vary behavior

**Framework requirement.** The application sets `Vary` headers to signal which
request headers affect the response. A `Vary: Accept-Encoding` header tells
caches that the response differs based on the client's accepted encodings.
A `Vary: Accept-Language` header tells caches that the response differs based on
language preference. The adapter and routes set these headers appropriately.

**Proxy requirement.** Respect the `Vary` header when caching. A cache key must
include the values of headers named in `Vary`. If the proxy ignores `Vary`, it
may serve an incompatible response. For example, a gzip-compressed response to
a client that does not accept gzip breaks client rendering.

The `Cache-Control` header on the response determines TTL and revalidation. The
proxy should honor `Cache-Control: no-cache`, `no-store`, and `private` so the
application can opt out of proxy caching when needed. Do not cache `Set-Cookie`
responses. These are per-client and must not be stored.

## Conforming deployments

A reverse proxy such as nginx or HAProxy on the same host as a Node deployment
satisfies this contract. A CDN that correctly preserves request and response
headers, respects `Vary` and `Cache-Control`, and streams responses also
satisfies this contract. The example at [`examples/vm-node/nginx.conf`](../../examples/vm-node/nginx.conf)
demonstrates a conforming nginx configuration for a single-host reverse proxy.

The key principle: a proxy must be transparent for headers and response integrity.
It can optimize streaming, caching, and compression, but it must not mutate
security headers, drop cookies, or cache responses that should not be cached.
