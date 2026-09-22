import { createContext, createElement, useContext, type ReactNode } from "react";
import { createCsrfCookie, createCsrfToken, parseCookieHeader } from "./csrf";
import type { CsrfClientOptions } from "./csrf";

export type CsrfRenderContext = {
  isSameOrigin: (action: string | undefined) => boolean;
  token: (options?: CsrfClientOptions) => string | undefined;
};

type CsrfRenderState = {
  context: CsrfRenderContext;
  cookies: () => readonly string[];
  seal: () => void;
  used: () => boolean;
};

const Context = createContext<CsrfRenderContext | undefined>(undefined);

export function createCsrfRenderState(request: Request): CsrfRenderState {
  const requestCookies = parseCookieHeader(request.headers.get("cookie"));
  const requestUrl = new URL(request.url);
  const issued = new Map<string, string>();
  const secure = new URL(request.url).protocol === "https:";
  let sealed = false;
  let used = false;

  return {
    context: {
      isSameOrigin(action) {
        try {
          return new URL(action ?? requestUrl.href, requestUrl).origin === requestUrl.origin;
        } catch {
          return false;
        }
      },
      token(options = {}) {
        used = true;
        const cookie = options.cookie ?? "csrf-token";
        const existing = requestCookies.get(cookie);
        if (existing) return existing;
        const current = issued.get(cookie);
        if (current) return current;
        if (sealed) {
          throw new Error(
            "A CSRF-protected Form cannot first render after streaming response headers are ready.",
          );
        }
        const value = createCsrfToken();
        issued.set(cookie, value);
        return value;
      },
    },
    cookies: () => [...issued].map(([cookie, token]) =>
      createCsrfCookie(token, { cookie, secure })
    ),
    seal: () => {
      sealed = true;
    },
    used: () => used,
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

export function useCsrfFormToken(
  options: CsrfClientOptions | false = {},
  actions: readonly (string | undefined)[] = [],
) {
  const context = useContext(Context);
  if (options === false) return undefined;
  if (context && !actions.every(context.isSameOrigin)) return undefined;
  if (typeof window !== "undefined" && !actions.every((action) => {
    try {
      return new URL(action ?? window.location.href, window.location.href).origin === window.location.origin;
    } catch {
      return false;
    }
  })) return undefined;
  if (context) return context.token(options);
  if (typeof document === "undefined") return undefined;
  return parseCookieHeader(document.cookie).get(options.cookie ?? "csrf-token");
}
