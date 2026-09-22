import { createContext, createElement, useContext, type ReactNode } from "react";
import { createCsrfCookie, createCsrfToken, parseCookieHeader } from "./csrf";
import type { CsrfClientOptions } from "./csrf";

export type CsrfRenderContext = {
  token: (options?: CsrfClientOptions) => string | undefined;
};

type CsrfRenderState = {
  context: CsrfRenderContext;
  cookies: () => readonly string[];
};

const Context = createContext<CsrfRenderContext | undefined>(undefined);

export function createCsrfRenderState(request: Request): CsrfRenderState {
  const requestCookies = parseCookieHeader(request.headers.get("cookie"));
  const issued = new Map<string, string>();
  const secure = new URL(request.url).protocol === "https:";

  return {
    context: {
      token(options = {}) {
        const cookie = options.cookie ?? "csrf-token";
        const existing = requestCookies.get(cookie);
        if (existing) return existing;
        const current = issued.get(cookie);
        if (current) return current;
        const value = createCsrfToken();
        issued.set(cookie, value);
        return value;
      },
    },
    cookies: () => [...issued].map(([cookie, token]) =>
      createCsrfCookie(token, { cookie, secure })
    ),
  };
}

export function withCsrfRenderContext(
  context: CsrfRenderContext | undefined,
  children: ReactNode,
) {
  return context
    ? createElement(Context.Provider, { value: context, children })
    : children;
}

export function useCsrfFormToken(options: CsrfClientOptions | false = {}) {
  const context = useContext(Context);
  if (options === false) return undefined;
  if (context) return context.token(options);
  if (typeof document === "undefined") return undefined;
  return parseCookieHeader(document.cookie).get(options.cookie ?? "csrf-token");
}
