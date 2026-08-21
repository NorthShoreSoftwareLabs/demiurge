import type { SecureCookieDefinition } from "@demiurgejs/core";

// Declared once and imported by both the route that writes this cookie and
// any client script that reads it back. A rename or a scope change here
// reaches both sides, with no second, hand-typed copy.
export const preferenceCookie: SecureCookieDefinition = {
  httpOnly: false,
  name: "preference",
  sameSite: "Strict",
};
