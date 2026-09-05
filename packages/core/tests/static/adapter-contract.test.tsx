import { describe, expect, it, vi } from "vitest";
import {
  defineRoutePolicy,
  page,
  security,
  text,
  type LayoutProps,
  type NotFoundProps,
  type RouteModule,
  type RouteProps,
} from "@demiurgejs/core";
import { generateStaticOutput, staticAdapter } from "@demiurgejs/core/static";
import { verifyAdapterContract } from "../../src/adapter/testing";

// Each route needs an inherited access declaration, because the request
// pipeline denies a route that declares none. A test that does not examine
// authorization declares public access here.
function routeModule(module: RouteModule) {
  return vi.fn(async () => ({
    ...module,
    policy: { access: { public: true }, ...module.policy },
  }));
}

function Layout({ children }: LayoutProps) {
  return <div className="shell">{children}</div>;
}

function NotFound({ pathname }: NotFoundProps) {
  return <main>Nothing at {pathname}</main>;
}

function Home({ data }: RouteProps<string, { message: string }>) {
  return <main>{data.message}</main>;
}

const routes = {
  "./routes/@layout.tsx": routeModule({ default: Layout }),
  "./routes/@not-found.tsx": routeModule({ default: NotFound }),
  "./routes/@policy.ts": routeModule({
    policy: defineRoutePolicy({ document: security.static() }),
  }),
  "./routes/index.tsx": routeModule({
    GET: page<string, { message: string }>({
      data: async () => ({ message: "Built at export time" }),
      render: { mode: "static" },
      view: Home,
    }),
  }),
  "./routes/robots.txt.ts": routeModule({
    GET: text("User-agent: *\nAllow: /\n"),
  }),
};

describe("static adapter contract", () => {
  it("proves every capability the static adapter declares", async () => {
    await expect(
      verifyAdapterContract(staticAdapter, {
        staticOutput: (outDir) =>
          generateStaticOutput({
            origin: "https://static.example.test",
            outDir,
            routes,
          }),
      }),
    ).resolves.toBeUndefined();
  });

  it("declares the capabilities the contract proved", () => {
    expect(staticAdapter).toEqual({
      capabilities: {
        backgroundLifetime: false,
        crossOriginIsolationHeaders: false,
        nonceInjection: false,
        sharedCache: false,
        staticOutput: true,
        streaming: false,
        webSocket: false,
        webTransport: false,
      },
      name: "static",
    });
  });
});
