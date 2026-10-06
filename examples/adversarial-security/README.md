# Adversarial security fixture

This application verifies security behavior against deliberately hostile input.
It imports Demiurge through public package exports.

The fixture separates application permission decisions from framework
enforcement. Root middleware creates an application-owned principal from test
headers or cookies. The `/secure` policy requires that principal before a route
loader runs. The record loader then applies the tenant permission decision.

The private record query includes the tenant and user in its cache key.
Concurrent requests can therefore detect cross-user cache disclosure. Route
data projects only display-safe fields into the browser payload. The server
record keeps `adversarial-server-secret-7f31c9` behind the server-only boundary.

Other routes expose these contracts:

- `/api/limited` rejects a body larger than 32 bytes before its effect runs.
- `/api/effects` reports the accepted body count.
- `/api/proxy` shows that untrusted proxy headers do not change request metadata.
- `/api/redirect-safe` returns a same-origin mutation redirect.
- `/api/redirect-unsafe` returns a cross-origin mutation redirect for browser rejection.

The `fixtures/transitive-server-only` directory is an invalid source overlay.
A packed-consumer test copies it into an application and expects the build to
reject the transitive server-only import.
