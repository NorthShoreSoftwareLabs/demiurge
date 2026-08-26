# ADR 0012: Locale Resolution and Routing

## Status

Accepted.

## Context

Tracking: [GitHub issue #262](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/262)

Demiurge must select one locale for routing, documents, metadata, static output,
and framework cache identity.

Applications can obtain locale preferences from a URL, a domain, a cookie, or
the `Accept-Language` request header. These inputs do not have equal authority.

A locale in a URL identifies a resource. A cookie or request header states a
preference and can change without a URL change.

Static generation has no request cookie or request header. Browser navigation
and direct document requests must still select the same locale.

Demiurge must define this protocol without owning translations or message
catalogs. Applications must also be able to replace the locale resolver.

## Decision

### Ownership

Demiurge owns locale identity when the identity changes framework output. It
also owns routing integration, canonical redirects, and cache isolation rules.

The application owns its supported locales, default locale, translations, and
message loading. It also owns the locale preference interface.

Core does not define a translation function or a message catalog format.

### Locale identity

An application declares a non-empty ordered set of supported locale identifiers.
It also selects one supported identifier as the default locale.

Each identifier is a canonical Unicode BCP 47 language tag. Configuration
normalizes identifiers with the platform locale canonicalization algorithm.

Configuration fails when an identifier is invalid. It also fails when two
configured values have the same canonical form.

The canonical configured identifier is the framework locale identity. It is
the value that routes, documents, metadata, static paths, and cache keys use.

Language matching uses the application set only. The resolver does not create
an unconfigured regional locale from a less-specific language match.

The application can declare aliases for incoming URL labels and domain labels.
An alias resolves to one supported identity. An alias is never an output locale.

The default locale is a fallback. It is not an unsupported-locale replacement
for an explicit URL or domain value.

### URL strategies

An application can bind locale identity to a path prefix, a domain, or neither.
Path and domain bindings can exist together for explicit migrations.

A path binding maps a leading URL segment to a supported locale. The locale
segment is separate from the application route pattern and route parameters.

A domain binding maps a normalized host to a supported locale. Ports are not
part of the configured production domain identity.

The application declares whether the default locale has a path prefix. If it
omits that prefix, an explicit default-locale prefix redirects to the unprefixed
canonical URL.

When a path and domain both identify a locale, the path has higher precedence.
A conflict redirects a page request to the canonical domain for the path locale.

An alias, non-canonical tag, or non-canonical configured path redirects to the
canonical URL. The redirect preserves the route path, query, and fragment where
the client supplied them.

Canonicalization uses status 308 for `GET` and `HEAD`. The framework does not
automatically redirect an unsafe method.

An explicit unsupported path locale returns not found. It does not fall back
to the default locale and does not treat that segment as a locale-free route.

An unconfigured host does not become an unsupported locale. Normal host and
deployment validation rules continue to apply.

### Preference inputs and precedence

The default resolver evaluates these inputs in order:

1. A locale path prefix.
2. A locale domain binding.
3. The configured locale preference cookie.
4. The `Accept-Language` request header.
5. The configured default locale.

An invalid or unsupported preference cookie is ignored. An unmatched language
range in `Accept-Language` is also ignored.

The resolver uses quality weights and source order for `Accept-Language`. It
uses exact matches before progressively less-specific language matches.

The wildcard language range selects the default locale. A zero-quality range
does not select a locale.

Cookie and header inputs select a destination only when the canonical URL does
not already identify a locale. They never override a path or domain identity.

For a locale-aware page `GET` or `HEAD`, a selected preference redirects to the
canonical locale URL. This negotiation redirect uses status 307.

If the selected locale already uses the requested canonical URL, the request
continues without a redirect. This rule applies to an unprefixed default locale.

The preference cookie stores only a canonical supported locale identifier. The
application must explicitly enable and name the cookie.

### Replaceable resolver

The locale resolver is an application-supplied function with a framework default.
It receives normalized candidates, supported locales, the default locale, the
route kind, and the request method.

The resolver returns one supported locale identity and its source. It can also
return a canonical redirect or an unsupported explicit-locale result.

The resolver must be deterministic for the supplied input. It cannot depend on
hidden process state.

Core validates every result. It rejects an unconfigured locale, an external
redirect, and a redirect that conflicts with the route kind or request method.

Adapters provide normalized request inputs. They do not implement provider-specific
locale precedence.

Static generation uses the same resolver contract with a static input mode. A
custom resolver must support this mode if the application generates static pages.

### Page, API, and asset behavior

Locale-aware page routes use the complete resolution and redirect protocol.
Browser navigation resolves the target URL through the same protocol as a
direct document request.

API and other non-page routes use explicit path and domain locale identity when
their route declaration enables localization. They do not use a preference
cookie or `Accept-Language`, and they do not receive negotiation redirects.

An API client can select a locale through its explicit localized URL. An
application can read `Accept-Language` in its handler when content negotiation
is part of that API's own media contract.

Canonical redirects for localized API routes apply only to `GET` and `HEAD`.
An unsafe request to an alias or a conflicting locale URL fails without a
redirect. This rule prevents a redirect from changing mutation routing.

Framework assets and application static files are locale-neutral by default.
An application creates locale-specific asset URLs when asset bytes differ by
locale.

Errors and not-found pages use a valid explicit URL locale. Otherwise, they use
the resolved request locale when page negotiation can select one.

### Static and dynamic behavior

Static generation enumerates supported locale identities for each locale-aware
page. It creates only canonical path and domain combinations.

Static generation never reads a cookie or `Accept-Language`. A static host can
implement preference discovery only as a redirect before it serves an artifact.

The build fails when two locale and route combinations produce the same output
path for one deployment target.

The build also fails when a custom resolver cannot produce a deterministic
result for every declared static locale.

Dynamic rendering uses the same canonical locale identity as static generation.
Hydration data contains that identity so browser navigation does not infer it
from browser preferences.

A static artifact contains content for one locale identity. Runtime negotiation
cannot change that artifact's locale without a redirect to another artifact.

### Privacy

`Accept-Language` can add fingerprinting information. The framework uses it only
to select a supported locale and does not expose the complete header to browser
hydration data.

Framework diagnostics record the selected locale and source. They do not record
the preference cookie value or the complete `Accept-Language` header.

The locale cookie is a preference, not an authentication value. Its default
scope is `Path=/`, `SameSite=Lax`, and `Secure` on secure origins.

The application owns consent and retention policy for the preference cookie.
Core does not write the cookie only because a request contains `Accept-Language`.

### Cache behavior

A canonical path or domain is the preferred cache identity. A response at that
URL does not vary by the locale cookie or `Accept-Language`.

A negotiation redirect varies on every preference input that affected its
selection. The default resolver adds `Vary: Cookie, Accept-Language` when both
inputs are enabled.

Negotiation redirects use `Cache-Control: private, no-store`. A shared cache must
not reuse one visitor's preference redirect for another visitor.

Canonicalization redirects that depend only on the URL can use shared caching.
Their cache key must include the host when domain routing is enabled.

Framework render and data-cache identity includes the canonical locale identity.
It does not include the raw preference cookie or complete language header.

A custom resolver that varies a representation without changing its canonical
URL must declare the related request headers. Dynamic responses then include
those headers in `Vary` and cannot use shared caching without an equivalent
adapter cache key.

## Consequences

One canonical locale identity flows through routing, documents, metadata, static
generation, browser navigation, and framework caches.

URL identity wins over user preference. Unsupported explicit locales cannot
silently serve default-locale content.

Static output remains deterministic because request preferences only select a
canonical URL. API locale selection remains explicit and stable for clients.

Applications can replace locale resolution without replacing routing or message
loading. Core validates custom results at the framework boundary.

Later implementation issues must expose these rules as typed configuration and
must test path, domain, cookie, header, static, navigation, and cache behavior.
