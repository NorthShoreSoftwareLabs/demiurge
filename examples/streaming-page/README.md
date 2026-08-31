# Streaming Page Example

This production Node example opts its root page into
`render: { mode: "streaming" }`. The document metadata, strict CSP nonce,
layout, heading, and Suspense fallback flush in the shell. React streams the
deferred panel later and applies the same nonce to its inline completion script.
`serveNodeBuild` injects `renderNodePageResponse` into the generated handler
through `context.page.renderPage`, so the Node-only pipeable renderer never
enters the client bundle.

```sh
pnpm build
NODE_ENV=production pnpm start
```

The server defaults to `127.0.0.1:4190`. Set `HOST` and `PORT` for the target
runtime. Canceling the response body stops the React render. An error before the
shell becomes the normal 500 response. The framework reports an error after the
shell commit, and the HTTP status stays 200.
