import {
  createMemorySessionStore,
  createSessionManager,
  type ServerSession,
} from "@demiurgejs/core";
import type { Principal } from "./auth.server";

export type AuthenticationSessionData = {
  principal: Principal;
};

export type AuthenticationContext = {
  csrfToken: string;
  principal: Principal;
  session: ServerSession<AuthenticationSessionData>;
};

const store = createMemorySessionStore<AuthenticationSessionData>({
  namespace: {
    app: "admin-route-group",
    environment: "example",
    schemaVersion: 1,
  },
});

export const sessions = createSessionManager<AuthenticationSessionData>({
  absoluteExpirationMs: 8 * 60 * 60 * 1000,
  cookie: { name: "admin", sameSite: "Lax" },
  idleExpirationMs: 30 * 60 * 1000,
  keys: [{
    id: "demo-2026",
    value: new TextEncoder().encode("admin-route-group-demo-key-2026!"),
  }],
  store,
});

export function appendSessionCookies(
  response: Response,
  cookies: readonly string[],
) {
  for (const cookie of cookies) {
    response.headers.append("set-cookie", cookie);
  }

  return response;
}
