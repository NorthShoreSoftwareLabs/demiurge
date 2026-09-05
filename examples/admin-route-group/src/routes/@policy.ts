import { defineRoutePolicy, security } from "@demiurgejs/core";

export const policy = defineRoutePolicy({
  // The home page, the log-in page, and the not-found page serve every person.
  // The `(admin)` group adds a restriction in its own policy file.
  access: { public: true },
  document: security.strict(),
});
