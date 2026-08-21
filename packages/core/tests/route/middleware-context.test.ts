import { describe, expect, it } from "vitest";
import {
  createRequestHandler,
  defineMiddleware,
  json,
  page,
  text,
  type HttpRouteContext,
  type MiddlewareContextOf,
  type RouteMiddleware,
  type RouteRequestContextFor,
} from "@demiurgejs/core";

type AuthContext = {
  user: {
    id: string;
  };
};

const generatedContextCheck: RouteRequestContextFor<"/admin"> = {
  requestId: "request-1",
  role: "admin",
};
void generatedContextCheck;

type RootContext = { requestId: string };
type AdminContext = { role: "admin" };

declare module "@demiurgejs/core" {
  interface RouteRequestContexts {
    "/": AuthContext;
    "/api/profile": AuthContext;
    "/admin": RootContext & AdminContext;
    "/public": RootContext;
  }
}

describe("typed middleware request context", () => {
  it("passes one mutable carrier from middleware to route values", async () => {
    const middleware: RouteMiddleware<string, AuthContext> =
      defineMiddleware<AuthContext>(async ({ context }, next) => {
        context.user = { id: "user-1" };
        return await next();
      });
    const handler = createRequestHandler({
      routes: {
        "./routes/api/@middleware.ts": async () => ({ middleware }),
        "./routes/api/profile.tsx": async () => ({
          GET: json<
            { id: string },
            "/api/profile"
          >(({ context }) => ({ id: context.user.id })),
        }),
      },
    });

    const response = await handler(
      new Request("https://example.test/api/profile"),
    );

    await expect(response.json()).resolves.toEqual({ id: "user-1" });
  });

  it("accumulates nested middleware contributions in one carrier", async () => {
    const root = defineMiddleware<RootContext>(({ context }, next) => {
      context.requestId = "request-1";
      return next();
    });
    const admin = defineMiddleware<AdminContext>(({ context }, next) => {
      context.role = "admin";
      return next();
    });
    const handler = createRequestHandler({
      routes: {
        "./routes/@middleware.ts": async () => ({ middleware: root }),
        "./routes/admin/@middleware.ts": async () => ({ middleware: admin }),
        "./routes/admin/index.tsx": async () => ({
          GET: json<{ requestId: string; role: "admin" }, "/admin">(
            ({ context }) => ({
              requestId: context.requestId,
              role: context.role,
            }),
          ),
        }),
      },
    });

    const response = await handler(new Request("https://example.test/admin"));

    await expect(response.json()).resolves.toEqual({
      requestId: "request-1",
      role: "admin",
    });
  });

  it("keeps the context out of browser-facing route props", () => {
    type RouteProps = { path: {}; pathname: string; data?: undefined };
    type ContextKeys = keyof HttpRouteContext["context"];

    const props: RouteProps = null as never;
    const keys: ContextKeys = null as never;

    expect(props).toBeNull();
    expect(keys).toBeNull();
  });

  it("passes the same carrier to page data without serializing it", async () => {
    const middleware = defineMiddleware<AuthContext>(
      ({ context }, next) => {
        context.user = { id: "user-2" };
        return next();
      },
    );
    const handler = createRequestHandler({
      routes: {
        "./routes/@middleware.ts": async () => ({ middleware }),
        "./routes/index.tsx": async () => ({
          GET: page<"/", { id: string }>({
            data: ({ context }) => ({ id: context.user.id }),
            view: ({ data }) => data.id,
          }),
        }),
      },
    });

    const response = await handler(new Request("https://example.test/"));
    const html = await response.text();

    expect(html).toContain("user-2");
    expect(html).not.toContain('"context"');
  });
});

function typecheckOnly(_callback: () => void) {
  return;
}

typecheckOnly(() => {
  const middleware = defineMiddleware<AuthContext>(
    ({ context }, next) => {
      context.user = { id: "user-1" };
      return next();
    },
  );
  void middleware;

  json<{ requestId: string; role: "admin" }, "/admin">(({ context }) => ({
    requestId: context.requestId,
    role: context.role,
  }));

  text<"/public">(({ context }) => {
    const requestId: string = context.requestId;
    void requestId;
    // @ts-expect-error A route cannot read a value that no ancestor contributed.
    return context.role;
  });

  const legacy: RouteMiddleware = (_context, next) => next();
  void legacy;
  type LegacyContribution = MiddlewareContextOf<typeof legacy>;
  const legacyContribution: LegacyContribution = {};
  void legacyContribution;
  text<"/legacy">(({ context }) => {
    // @ts-expect-error An unbranded middleware contributes no typed values.
    return context.user;
  });
});
