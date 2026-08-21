# Route audit panel

The development server of Demiurge serves a route audit panel. The panel shows
what the framework decided for one request. It reports the matched route, the
effective policy, the rendered headers, the resolved metadata, the contributed
scripts, and the cache reads.

## Open the panel

Start the development server, then open this path in a browser:

```text
http://localhost:5173/_demiurge/audit?path=/blog/hello
```

The `path` value selects the route to audit. The default value is `/`. The form
at the top of the panel changes the value.

The panel reads the same route manifest that the development server uses. A
change to a route file therefore shows in the panel after a reload.

## What the panel reports

| Section | Content |
| --- | --- |
| Route | The matched file, the route pattern, the path values, the route groups, the layouts, the policy files, and the middleware |
| Findings | The result of `createSecurityAudit(...)` for the route |
| Response headers | The security headers that the response carries |
| Effective policy | The merged document policy, route security policy, and CORS policy |
| Metadata | The resolved document metadata |
| Scripts | Each contributed script with the policy status of that script |
| Cache behavior | The cache reads of the request, and the cache directives of the response |

The panel audits a page route with the document policy. The request handler
renders the document policy for a page response only. A resource route
therefore reports no document header and no nonce.

## Read the report as JSON

Add `format=json` to get the same report as JSON:

```text
http://localhost:5173/_demiurge/audit?path=/blog/hello&format=json
```

A script or an editor can read this report. The JSON keeps a policy function as
the text `[function]`, because JSON holds no function.

## The panel runs the data loader

An audit of a page route calls the `data` function of that page. The panel then
lists each cache key, scope, time to live, and tag that the request read. Treat
an audit as a normal request to the development server.

## Development only

Demiurge registers the panel from the Vite `configureServer` hook. Vite calls
that hook for the development server alone, so a production build and a static
export contain no panel and no audit code.

Two more conditions remove the panel:

- The environment variable `NODE_ENV` has the value `production`.
- The plugin option `devtools` has the value `false`.

```ts
import { demiurge } from "@demiurgejs/core/vite";

export default defineConfig({
  plugins: [demiurge({ devtools: false })],
});
```

The panel declares its own content security policy and sends `no-store`. It
does not change the policy of the application, and it adds no markup to an
application document.
