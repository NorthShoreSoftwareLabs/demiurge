# Action Result and Client Submission Protocol

- Status: Accepted
- Issue: #241
- Epic: #233

## Summary

An action is an HTTP method that changes application state. The action keeps
the standard `Response` contract. The browser router adds an optional client
submission protocol for forms and fetch requests.

## Action results

An action can return these result classes.

| Result | HTTP response | Client meaning |
| --- | --- | --- |
| Success | `2xx` | The submission completed. The client may revalidate the current route. |
| Invalid | `4xx` | The input is invalid. The client keeps the submission result for the form. |
| Redirect | `3xx` with `Location` | The client follows the location as a navigation. |
| Failed | `5xx` or an unexpected response | The client reports an action error and keeps the current route. |

An application can return any `Response`, including a response with a custom
status, headers, and body. The client treats a response without the action
protocol media type as an ordinary response. This rule keeps raw `Response`
returns valid.

## Client request

The browser sends a submission as a same-origin request. It preserves the form
method, action URL, credentials, and successful form controls. It sends the
`Accept` header with `application/vnd.demiurge.action+json` before the existing
application values.

The browser adds `X-Demiurge-Action: data` when it requests a protocol result.
The server can use this header to select a protocol representation. The server
must still return the normal HTML or raw `Response` representation when the
header is absent.

The browser sends `FormData` for a form submission. A caller can send JSON or
text with `fetch` when the action input parser supports that media type.

## Client response

A protocol response has the media type
`application/vnd.demiurge.action+json` and this JSON shape:

```json
{
  "status": "success",
  "data": null,
  "revalidate": true
}
```

The `status` value is one of `success`, `invalid`, `redirect`, or `failed`.
The `data` value is application-owned JSON for `success` and `invalid` results.
The `revalidate` value requests route-data revalidation after success.

Redirect responses keep the HTTP `Location` header and status. They do not
need a JSON body. A client follows only same-origin redirects through the
browser router. A cross-origin redirect uses the browser document navigation.

Invalid responses use a `4xx` status. The application owns the field error
shape in `data`. Failed responses use a `5xx` status and expose no server
details by default.

## Progressive enhancement

The server renders a native `<form>` with its real `action` and `method`
attributes. The form remains usable when JavaScript does not load.

When JavaScript loads, the router intercepts only same-origin forms that use a
supported method. It preserves the native form submission when the person uses
a new window, a modifier key, a submitter with a different target, or an
unsupported method.

The router restores the native browser result for protocol responses that it
does not understand. An application can therefore deploy a form before it
deploys the client protocol.

## History and cancellation

The router does not add a history entry for a successful submission by itself.
It adds an entry only when the action returns a redirect and the redirect
navigation requests a push. A replace redirect replaces the current entry.

The router aborts an obsolete in-flight submission when a newer submission or
navigation starts. The server may continue work after the client aborts. The
client ignores an aborted result and keeps the newest navigation state.

The router does not abort submissions that the application marks as non-
cancellable. Such a mark is an application-level request signal and does not
change the HTTP response contract.

## Library interoperability

The protocol uses `Request`, `Response`, `FormData`, `Headers`, and JSON from
the Web platform. Libraries can submit actions with `fetch` by setting the
request header and `Accept` value described above.

Libraries that do not support the protocol can use the action URL as a normal
HTML form endpoint. They receive the application response without framework
client state.

The protocol does not require a Demiurge-specific client runtime on the
server. A server adapter only needs to preserve the request headers, response
status, response headers, and response body.

## Decision consequences

Action handlers remain transport-independent. The browser router owns pending
state, cancellation, and navigation. The server owns validation, redirects,
errors, and application data. The application owns the JSON data shape.
