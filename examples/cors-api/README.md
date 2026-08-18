# CORS API Example

This example demonstrates the `cors` route policy and a real cross-origin
browser client calling it.

```sh
pnpm build
NODE_ENV=production pnpm start
pnpm start:client
```

`server.js` runs the Demiurge API on `http://localhost:4195`.
`client-server.js` is a plain static server, not a Demiurge app. It serves one
HTML page on `http://localhost:4196`. That page calls the API from a
genuinely different origin, the way a real third-party client would.

`/api/greeting` declares `cors: { origins: "*" }`. A plain GET with no custom
headers counts as a simple request. The browser sends it directly, and any
origin can read the response.

`/api/echo` declares an explicit origin list, `credentials: true`, and named
`headers` and `exposeHeaders` lists. Its JSON body and custom `x-demo-token`
request header make it a non-simple request. The browser sends a real
preflight `OPTIONS` request first. The route answers the preflight with the
allowed method, the allowed headers, and the exact client origin. A wildcard
origin cannot pair with `credentials: true`, so the policy names the client
origin instead.

`tests/integration/cors-api.ts` proves the CORS behavior against the running
server. It checks the preflight headers, the echoed response, and a denied
origin that gets no `access-control-allow-origin` header back. It also runs a
route source with `cors: { origins: "*", credentials: true }` through the
same static check the Vite plugin runs at build time. That check confirms the
combination fails before an application ever starts.

`browser-tests/cors-api.spec.ts` drives a real Chromium browser on the client
origin. It confirms the wildcard GET works with no preflight. It confirms the
credentialed POST completes, which only happens once the browser's own
preflight succeeds. It also confirms the exposed response header is readable
from page script.
