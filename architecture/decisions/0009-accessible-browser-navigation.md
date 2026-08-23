# ADR 0009: Accessible Browser Navigation

## Status

Accepted.

## Context

Tracking: [GitHub issue #280](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/280)

A document navigation gives the browser a new document. The browser resets the
focus context and exposes the new document title to assistive technology.
Browser navigation replaces route content without these browser actions.

The router can show loading, ready, not-found, and error content. A newer
navigation can also cancel a pending navigation. Focus and announcements must
describe only content that the router commits.

WCAG 2.2 does not specify one focus target for browser navigation. Success
Criterion 2.4.3 requires a focus order that preserves meaning and operation.
Success Criterion 2.4.2 requires a title that describes each view. Success
Criterion 4.1.3 requires software to expose applicable status messages without
moving focus.

ADR 0001 gives the application ownership of layouts, pages, fallbacks, and
styles. It gives Demiurge ownership of the document and the React mount. The
router therefore cannot select an application heading or landmark. It can
supply an opt-in boundary that the application puts on an owned element.

## Decision

### Navigation states

The router performs no accessibility transition during initial hydration. The
server document and the browser already establish the initial context.

The router performs no focus action while it shows loading content. It does not
announce loading content by default. An application can put its own status
semantics in an app-owned loading fallback.

The router performs one accessibility transition after it commits ready,
not-found, or error content. A render error is an error commit. The router must
wait until the final fallback commits before it performs the transition.

A cancelled or superseded navigation performs no accessibility transition.
Late data, loading modules, and error modules cannot change focus or the status
message.

These rules apply to link navigation and history navigation. They also apply
to keyboard, pointer, and programmatic activation. This behavior matches the
new-document focus reset and does not infer ability from an input method.

### Focus

Demiurge preserves focus by default. An application opts in to route focus
with `RouteFocusBoundary` or `useRouteFocusBoundary`.

`RouteFocusBoundary` is a polymorphic component. It renders only the element
selected by its `as` prop. It does not add a wrapper around that element.
The default element is `div`.

```tsx
<RouteFocusBoundary as="main">{children}</RouteFocusBoundary>
```

The rendered element has `tabIndex={-1}`. It accepts programmatic focus and
does not enter the sequential tab order. The component registers the element
as the route focus boundary.

The `as` prop accepts an intrinsic element or a component that forwards its
ref to one HTML element. TypeScript infers the selected element props and ref
type. The public props omit `tabIndex`, because the boundary owns that value.
The component forwards all other compatible props.

The component composes its registration ref with an application ref. Both refs
receive the same element. Registration occurs before the application receives
the element. During cleanup, the application ref receives `null` before the
component removes the registration. The internal `tabIndex={-1}` value takes
precedence over an untyped runtime `tabIndex` value.

`useRouteFocusBoundary` is the low-level primitive that the component uses. It
returns the registration ref and `tabIndex={-1}` props. A design-system
component must put both values on the same HTML element. It must compose the
registration ref with its own ref. The returned boundary props take precedence
over conflicting design-system props.

One router has one active boundary. The first mounted boundary is active. A
nested or duplicate boundary does not replace it. Development reports a clear
diagnostic for each extra boundary. Production keeps the first boundary and
continues navigation.

When the active boundary unmounts, the router removes its registration. If a
duplicate boundary remains mounted, the earliest remaining registration
becomes active. The router removes all registrations when it unmounts.

If no active boundary exists after a route commit, the router preserves the
current focus. It also preserves focus when the registered element unmounts or
disconnects before the focus operation. These conditions do not stop the
announcement.

The focus operation uses `preventScroll` when the browser supports it. Scroll
restoration and fragment navigation remain separate operations.

### Announcements

Demiurge adds one persistent status region to the framework-owned document.
The region exists before the router changes its text. It uses polite and atomic
status semantics.

The framework supplies the minimum presentation that visually hides the
region. This presentation is accessibility infrastructure, not application
visual policy. The application must not need a stylesheet for the default
announcement to work.

After a final commit, the router replaces the region text once. A ready or
not-found commit uses the resolved document title. An error commit uses the
resolved error-document title. If no new error title exists, it uses
`Navigation failed`.

The router does not use an assertive alert by default. An application error
fallback can provide an alert when the error requires immediate attention.

Automated tests verify that the region exists before navigation. They verify
its semantics and one text update for each committed navigation. These tests do
not claim that a screen reader spoke specific words. Manual assistive-technology
tests record that result when a release needs that evidence.

### Hash navigation

A change to only the URL fragment is not a route commit. The router does not
move focus to the route boundary and does not announce the document title.

The browser owns fragment targeting. Demiurge preserves browser scrolling and
focus behavior for a matching fragment. A missing or malformed fragment does
not cause a route accessibility transition.

A route commit with a fragment performs the route transition first. The router
then applies fragment behavior instead of focusing the registered boundary. A
matching fragment target gets browser fragment behavior. A missing or malformed
target preserves focus. The router does not announce the route title because
the fragment supplies the requested context.

History traversal uses the same fragment rules as link navigation. Scroll
restoration can restore a saved position only when no fragment target applies.

### Application overrides

`createFileRouter` and `hydrateFileRouter` accept an optional
`navigationAccessibility` value for announcement control. It has this field:

```ts
type NavigationAccessibility = {
  announce?: "title" | false | ((context: NavigationCommit) => string | null);
};
```

The default announcement value is `"title"`. `false` disables the framework
announcement. An announcement function returns the complete message. A `null`
or empty result makes no status-region update.

`NavigationCommit` contains the destination URL, the navigation kind, the
outcome, and the resolved title. The navigation kind is `"push"` or `"pop"`.
The outcome is `"ready"`, `"not-found"`, or `"error"`.

The announcement override runs only for a final committed navigation. It does
not run for hydration, loading, cancellation, or a hash-only change.

The router catches an announcement callback error and skips the announcement.
An application callback cannot break route rendering.

Native document navigation does not act on a registered boundary. The hook is
a safe no-op without a browser router. Document navigation does not create the
status region. The announcement options have no effect in document mode.

## Consequences

Browser navigation has a deterministic focus and announcement lifecycle. The
lifecycle follows committed route state instead of request completion. Focus
movement requires an application-owned boundary.

Applications can replace or disable announcements. They can use the component
API or the hook API to integrate route focus with their element system.

The framework adds one non-visual document element. It also adds the minimum
style for the status region. This addition is an explicit exception to the
application style boundary in ADR 0001. The application owns the focus element
and its visual presentation.

The resolved title becomes an input to the accessibility transition. The
implementation therefore depends on the navigation document contract from
issue #279.

The browser tests can verify focus, region semantics, message count, and
cancellation. They cannot verify speech from all browser and screen-reader
combinations.
