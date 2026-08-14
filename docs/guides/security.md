# Security

Demiurge applies security policy in the shared route pipeline so development,
Node production, and static output use the same declarations.

## Inherited policy

Add `@policy.ts` at any route-tree level:

```ts
import { security } from "@demiurgejs/core";

export const policy = {
  document: security.strict(),
};
```

Policy merges root-to-leaf. A route helper may add capability-specific CORS,
request, or security options. Deliberate relaxations remain visible at the
route instead of hiding in unrelated global middleware.

## Strict documents

`security.strict()` provides a nonce-based Content Security Policy and HSTS on
HTTPS. It also provides `frame-ancestors 'none'`, `nosniff`, a referrer policy,
a permissions policy, and same-origin COOP and CORP defaults.

The framework-owned document attaches the request nonce to managed scripts,
JSON-LD, hydration data, and React streaming payloads. A dynamic policy that
requires a nonce fails closed when no nonce is available.

Static output uses hash-based policy. `security.static()` and `cspHash(...)`
describe hashes that remain valid without a request nonce. Static generation
rejects nonce-dependent output and other policy it cannot deploy safely.

Static generation adds hashes for framework-rendered structured data. An
application must declare hashes for its other inline scripts.

The Vite plugin disables automatic asset inlining by default. This setting
prevents generated data URLs from conflicting with the default CSP.

An application can set `build.assetsInlineLimit` explicitly. If the application
enables inlining, add `data:` to each applicable CSP directive.

Trusted Types is explicit because enabling enforcement can break third-party
code in browsers the application does not control. Report-only policy can send
violations to `createSecurityReportHandler(...)` before enforcement is enabled.

## CSRF

Cookie-authenticated unsafe methods receive double-submit CSRF protection by
default. Use `issueCsrfToken(...)`, `createCsrfToken(...)`, and
`createCsrfCookie(...)` to issue the matching token and cookie. A route can make
an explicit, auditable exemption when another authentication model makes CSRF
inapplicable.

## CORS and request policy

Response helpers accept typed CORS declarations. Demiurge validates origins,
methods, wildcard-plus-credentials combinations, emits preflight responses,
and applies the resulting headers through the same request pipeline.

Route security can also enforce:

- allowed HTTP methods
- request-body and upload limits
- fixed-window rate limits with replaceable storage
- webhook HMAC verification against exact request bytes
- WebSocket origin checks

The Node adapter ignores forwarded identity headers until the application
declares a trusted proxy policy. Host allowlists are mandatory. These settings
prevent rate limits, secure URLs, and origin checks from trusting attacker-owned
headers.

## Reports and audits

`createSecurityReportHandler(...)` accepts CSP and Reporting API payloads with
media-type and body-size validation. It supports both compatibility `report-uri`
and named Reporting API endpoints.

`createSecurityAudit(...)` inspects effective route policy, rendered security
headers, static scripts, reporting configuration, and declared third-party
script dependencies. Audit findings explain policy conflicts. They do not
replace runtime reports for conditions that only a browser can observe.

Build-time policy verification beyond static output is proposed in
[RFC 0001](../../rfcs/0001-static-policy-verification.md).

## Environment validation

`defineEnvSchema(...)`, `env.*(...)`, and `validateEnv(...)` validate required
configuration and secrets before request handling begins. Keep secrets on the
server and pass only deliberate public values into document or browser data.

## Cross-origin isolation

`security.crossOriginIsolated()` configures COOP, COEP, and CORP for features
that require an isolated browsing context. Every cross-origin subresource must
cooperate with that policy, so enable it only after auditing scripts, fonts,
images, workers, and embeds.
