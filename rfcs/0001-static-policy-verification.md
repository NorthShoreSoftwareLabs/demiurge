# RFC 0001: Static Policy Verification

Status: proposed

Tracking: [GitHub issue #115](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/115)

## Goal

Demiurge knows a great deal about an app at build time that it currently only
checks at request time. Route policies, CORS policies, CSP directives, document
script contributions, and adapter capabilities are all values the build can see.
The framework validates some values only when the first request reaches the
route. This behavior conflicts with the enforcement doctrine. A detectable
error must fail at the earliest possible stage.

This RFC covers one reusable mechanism for verifying declared policy against
declared use, and the checks that mechanism enables. Browser capability helpers
such as `worker()` and `wasm()` are later consumers of the same mechanism, not
part of this slice.

## Decisions Made

### Scope doctrine

- Something belongs in core when the rest of the framework gets better because
  it is there. If nothing else in Demiurge can assume it, it is a utility and
  does not ship in core.
- There is no second tier for pure conveniences. `ResizeObserver`, debounce
  helpers, and worker pool managers fail the test and stay out. If they ever
  want a home it is a separate package with a separate version number and a
  lower stability promise.
- The reason for the restriction is support surface, not purity. Utilities that
  do not compound are exactly the ones with no defense when something better
  appears in userland.

### The helper is the declaration

- Following the framework's convention is what buys the machinery. Calling
  `worker(new URL("./x.worker.ts", import.meta.url))` is what tells the build
  that every route transitively importing that module needs `worker-src`. There
  is no separate annotation to keep in sync.
- Declarations move through the module graph. The build computes the effective
  route policy. The application does not maintain this policy manually. This
  process also records the source. For example, `/editor` allows `worker-src`
  because `src/editor/pdf.ts` requires it. The
  [platform boundaries](../architecture/platform-boundaries.md) require audit output to explain
  why each permission exists, and only the hoisted form can answer that.
- Route-level policy declaration remains the escape hatch for code the app
  cannot edit, primarily `node_modules`.
- App-level config is rejected, consistent with existing doctrine.

### Findings ladder

Certainty decides where a finding surfaces. Severity (how bad) and surface
(where it appears) are independent axes and should be separate fields on
`SecurityAuditFinding`, which today carries only `severity`.

| Rung | Condition | Consequence |
| --- | --- | --- |
| Fatal build | Provable from source, fixable in first-party code | Build exits |
| Fatal startup | Depends on the environment, knowable at boot | Process fails to start |
| Dev diagnostic | Build suspects but cannot prove | Dev surface only, build passes |
| Audit only | True but not actionable at the call site | `demiurge audit` output |
| Runtime report | Only observable in a browser | Report endpoint, doctrine rule 4 |

Invariants:

- Nothing nondeterministic is ever fatal. A gate that fails CI once for no
  reason gets an ignore flag added within a week.
- The same code produces the same finding in dev and in build. Only the
  consequence differs. There is never a finding that exists in one mode and not
  the other. This is the specific Next.js behavior to avoid.
- Dynamic construction the AST can see the shape of but not the value is a dev
  diagnostic, never a build failure.
- Findings in `node_modules` are audit-only. The developer cannot correct them
  by editing application code. Build findings that users cannot correct reduce
  the value of the channel.

The startup rung was missing from the original doctrine, which covers only
build-time failure (rule 3) and browser-only reporting (rule 4).

### Build reads route files, it does not run them

- The Vite plugin already parses route files and walks the AST in
  `stripClientPageData` (`vite/plugin.ts:278`). Policy verification adds a second
  visitor to a walk that already happens.
- Route modules are never evaluated at build time. Evaluating them would mean
  top-level side effects firing, server-only imports loading, and env-derived
  policies reading whatever the build machine happens to have.
- The AST reader's only job is turning a literal into a real object. It must not
  learn any policy semantics. It extracts, then calls the same
  `validateCorsPolicy` every other path calls. Two implementations of what a
  valid policy is would diverge, and the build would start disagreeing with
  production about the same file.
- A policy the reader cannot resolve to a literal is not guessed at and not
  warned about. It is recorded as unverified and handed to the startup check.

### Startup validation

- Automatic inside `createRequestHandler`, at construction rather than on first
  request, so a bad policy fails the process before it can serve anything.
- Not opt-in. An app that has to remember to call it is an app that forgets.
- `validateEnv` runs in the same pass. It currently has no caller anywhere in
  the framework.
- Runtime validation stays exactly where it is, as defense in depth.

### Rendering fork, parked

- RSC is the selected direction for server component rendering and Flight must
  operate under strict CSP.
- This RFC does not introduce a second islands-style rendering model.
- React supplies the RSC runtime parts. It does not supply bundler integration.
  The integration must split the module graph on the `react-server` export
  condition. It must also create reference registries and connect Flight to
  responses and navigation.
- Nothing in this spec may assume a hydration mode exists.

## Features To Implement

### Wiring, logic already written and tested

`createSecurityAudit` (`security/audit.ts`) is exported from the public API,
has roughly twenty tests in `tests/security/policy.test.ts`, and has no caller
anywhere in the framework. Running it at build is mostly plumbing.

Existing findings: `csp-script-missing-nonce`, `csp-script-src-blocked`,
`security-header-render-failed`, `report-only-target-missing`,
`script-purpose-missing`, `script-integrity-missing`,
`script-third-party-before-interactive`, `script-gtm-wide-trust-boundary`.

Existing throwing validators to move to build time: `validateCorsPolicy`
(`security/cors.ts:120`, currently called per request from `createCorsHeaders`
at `cors.ts:13`), `validateRateLimitPolicy`.

`validateStaticCsp` (`static/index.ts:275`) already catches nonce-backed CSP in
static output, but only on the static export path.

### New checks, low cost

- **Malformed origin strings.** `resolveAllowedOrigin` (`cors.ts:145`) is an
  exact string match, so `origins: ["https://example.com/"]` with a trailing
  slash never matches anything, silently, forever. Readable off the literal.
- **CORS methods a route cannot serve.** `createCorsPreflightResponse` builds
  the allowed method list from the route's capabilities. A route declaring
  `cors: { methods: ["POST"] }` while exporting no `POST` is promising something
  the address cannot do. Both halves live in the file the AST already walks.
- **Nonce token on a non-nonce adapter.** A CSP containing `{nonce}` deployed to
  an adapter whose `nonceInjection` capability is false is broken on arrival.
  Joins `AdapterCapability` and `assertAdapterCapabilities` to the policy layer.

### CSP and CORS type ergonomics

Small, independent of the mechanism, possibly a separate slice:

- `CspSource` (`security/types.ts:4`) ends in `| string`, which collapses the
  union and removes autocomplete entirely. The `(string & {})` form preserves
  suggestions while still accepting arbitrary sources.
- `{nonce}` is a magic token discoverable only by reading source.
  `securityPolicyRequiresNonce` scans for the substring.
- `mergeCsp` combines arrays. A route can widen a directive but cannot narrow it.
  The `csp: false` option removes the complete policy, not one directive.
- `ContentSecurityPolicy` has no `workerSrc`, `childSrc`, `frameSrc`,
  `manifestSrc`, or `mediaSrc`. The strict preset therefore cannot express a
  policy that permits a worker, and an app cannot declare one even deliberately.
  `'wasm-unsafe-eval'` appears nowhere in the repo.

## Open Decisions

- **Severity assignment for existing audit findings.** Proposal: make the three
  `error` rows fatal during the build. Each row identifies an application script
  that application policy will block. The four `warning` rows never fail the
  build. They appear only in `demiurge audit`. Style opinions must not make build
  failures seem optional. New CORS literal checks are fatal.
  Not yet accepted.
- **Function-form contributions.** `ScriptContribution` can be a function of the
  request context. Therefore, route scripts might not exist before a request
  arrives. The build cannot verify these scripts or `cors: publicApi`.
  Open question: Should the static array be the recommended default?
  Should the function form explicitly disable verification? Alternatively,
  should both forms have equal status and use startup and runtime checks?
  **This is where the session stopped.**
- **Roadmap ordering.** RSC is Phase 6. The Vite Environment API abstraction is
  Phase 9. Multi-graph RSC on Vite uses similar Environment API functions.
  Check whether Phase 6 depends on Phase 9 machinery.
- **CORS origin patterns.** `origins` accepts exact strings only. Subdomain
  allowlists are a common real need and a classic source of origin-matching
  bugs. If added, a typed form such as `{ subdomainsOf: "example.com" }` keeps
  the anchoring in framework hands rather than accepting a regex.
- Whether the dev diagnostic rung ships as terminal output through the plugin's
  `this.warn` or waits for a real overlay. Nothing currently touches the HMR
  socket. `configureServer` only watches for typed routes.

## Later Consumers, Out Of Scope Here

- `worker()` and `wasm()`, which need `workerSrc`/`childSrc` on the CSP type and
  a `wasm-unsafe-eval` opt-in before the helpers are worth writing.
- Cross-origin isolation conflict detection. `security.crossOriginIsolated()`
  sets `COEP: require-corp`, which breaks every third-party subresource without
  CORP, including scripts added through the integrations API. Detectable at
  build from declared integration origins.
- The visibility and idle scheduler, which revives the script strategies removed
  in `7510f33` and whose main value is deferring third-party embeds. Fenced to
  scripts and app-controlled lazy mounting. It must not learn how to hydrate a
  React subtree, because that is islands by accident.
- Client-Hints-seeded media queries, which pull `Accept-CH` into the document
  pipeline and `Vary` into `data/cache.ts`, where no concept of `Vary` exists
  today. The cache-key rule is the one already written for experiments in
  the [platform boundaries](../architecture/platform-boundaries.md).
- Speculation Rules and View Transitions. Both pass the inclusion test but are
  router and document work rather than capability-policy work.

## Tests Required

- Plugin tests for literal extraction, including the unresolvable cases.
- Build-failure tests for each fatal check.
- Startup-failure tests for `createRequestHandler` construction.
- Proof that build and dev produce identical findings for identical source.
