import { describe, expect, it, vi } from "vitest";
import {
  page,
  type LayoutProps,
  type RouteModule,
  type RoutePolicy,
  type RouteProps,
} from "demiurge";
import {
  unstable_createRouteManifest,
  unstable_findRouteMatch,
  unstable_loadErrorFallback,
  unstable_loadLoadingFallback,
  unstable_matchSegments,
  unstable_splitPathname,
  unstable_toRouteSegments,
} from "demiurge/internal/testing";

function View(_props: RouteProps) {
  return null;
}

function RootLayout(_props: LayoutProps) {
  return null;
}

function BlogLayout(_props: LayoutProps) {
  return null;
}

function routeModule(module: RouteModule) {
  return vi.fn(async () => module);
}

describe("file route conventions", () => {
  it("turns route filenames into route segments", () => {
    expect(unstable_toRouteSegments(["index"])).toEqual([]);
    expect(unstable_toRouteSegments(["blog", "index"])).toEqual(["blog"]);
    expect(unstable_toRouteSegments(["blog", "[slug]"])).toEqual([
      "blog",
      ":slug",
    ]);
    expect(unstable_toRouteSegments(["docs", "[...path]"])).toEqual([
      "docs",
      "*path",
    ]);
    expect(unstable_toRouteSegments(["(admin)", "users"])).toEqual(["users"]);
  });

  it("splits pathnames without empty leading or trailing segments", () => {
    expect(unstable_splitPathname("/")).toEqual([]);
    expect(unstable_splitPathname("/blog/")).toEqual(["blog"]);
    expect(unstable_splitPathname("/blog/file-based-routing")).toEqual([
      "blog",
      "file-based-routing",
    ]);
  });

  it("matches static, dynamic, and catchall path variables", () => {
    expect(unstable_matchSegments(["blog"], ["blog"])).toEqual({});
    expect(
      unstable_matchSegments(["blog", ":slug"], ["blog", "hello%20world"]),
    ).toEqual({ slug: "hello world" });
    expect(unstable_matchSegments(["docs", "*path"], ["docs", "a", "b"]))
      .toEqual({ path: "a/b" });
    expect(unstable_matchSegments(["blog"], ["blog", "extra"])).toBeNull();
  });

  it("classifies @layout files as layouts and normal names as routes", () => {
    const adminPolicy = {
      security: { csrf: true },
    } satisfies RoutePolicy;
    const manifest = unstable_createRouteManifest({
      "./routes/@layout.tsx": routeModule({ default: RootLayout }),
      "./routes/blog/@layout.tsx": routeModule({ default: BlogLayout }),
      "./routes/(admin)/@layout.tsx": routeModule({ default: BlogLayout }),
      "./routes/@error.tsx": routeModule({ default: RootLayout }),
      "./routes/@loading.tsx": routeModule({ default: RootLayout }),
      "./routes/blog/@not-found.tsx": routeModule({ default: BlogLayout }),
      "./routes/@middleware.ts": routeModule({}),
      "./routes/(admin)/@middleware.ts": routeModule({}),
      "./routes/(admin)/@policy.ts": routeModule({ policy: adminPolicy }),
      "./routes/(admin)/users.tsx": routeModule({ GET: page(View) }),
      "./routes/index.tsx": routeModule({ GET: page(View) }),
      "./routes/@policy.ts": routeModule({ policy: { security: { csrf: true } } }),
      "./routes/policy.tsx": routeModule({ GET: page(View) }),
      "./routes/blog/[slug].tsx": routeModule({ GET: page(View) }),
    });

    expect(manifest.layouts.map((layout) => layout.file)).toEqual([
      "./routes/@layout.tsx",
      "./routes/(admin)/@layout.tsx",
      "./routes/blog/@layout.tsx",
    ]);
    expect(manifest.routes.map((route) => route.file)).toContain(
      "./routes/policy.tsx",
    );
    expect(manifest.routes.map((route) => route.file)).not.toContain(
      "./routes/@policy.ts",
    );
    expect(manifest.routes.map((route) => route.file)).not.toContain(
      "./routes/@middleware.ts",
    );
    expect(
      manifest.routes.find((route) => route.file === "./routes/(admin)/users.tsx")
        ?.segments,
    ).toEqual(["users"]);
    expect(
      manifest.routes.find((route) => route.file === "./routes/(admin)/users.tsx")
        ?.fileSegments,
    ).toEqual(["(admin)", "users"]);
    expect(manifest.policies.map((policy) => policy.file)).toEqual([
      "./routes/@policy.ts",
      "./routes/(admin)/@policy.ts",
    ]);
    expect(manifest.policies.map((policy) => policy.segments)).toEqual([
      [],
      [],
    ]);
    expect(manifest.policies.map((policy) => policy.fileSegments)).toEqual([
      [],
      ["(admin)"],
    ]);
    expect(manifest.middlewares.map((middleware) => middleware.file)).toEqual([
      "./routes/@middleware.ts",
      "./routes/(admin)/@middleware.ts",
    ]);
    expect(
      manifest.middlewares.map((middleware) => middleware.fileSegments),
    ).toEqual([[], ["(admin)"]]);
    expect(manifest.fallbacks.loading.map((fallback) => fallback.file)).toEqual([
      "./routes/@loading.tsx",
    ]);
    expect(manifest.fallbacks.error.map((fallback) => fallback.file)).toEqual([
      "./routes/@error.tsx",
    ]);
    expect(manifest.fallbacks.notFound.map((fallback) => fallback.file)).toEqual([
      "./routes/blog/@not-found.tsx",
    ]);
  });

  it("loads the closest inherited loading fallback for matched page routes", async () => {
    const AdminLoading = () => null;
    const RootLoading = () => null;
    const manifest = unstable_createRouteManifest({
      "./routes/@loading.tsx": routeModule({ default: RootLoading }),
      "./routes/(admin)/@loading.tsx": routeModule({ default: AdminLoading }),
      "./routes/(admin)/users.tsx": routeModule({ GET: page(View) }),
      "./routes/about.tsx": routeModule({ GET: page(View) }),
    });

    await expect(unstable_loadLoadingFallback(manifest, "/users")).resolves.toBe(
      AdminLoading,
    );
    await expect(unstable_loadLoadingFallback(manifest, "/about")).resolves.toBe(
      RootLoading,
    );
    await expect(unstable_loadLoadingFallback(manifest, "/missing")).resolves.toBe(
      undefined,
    );
  });

  it("loads the closest inherited error fallback for matched routes and paths", async () => {
    const AdminError = () => null;
    const RootError = () => null;
    const manifest = unstable_createRouteManifest({
      "./routes/@error.tsx": routeModule({ default: RootError }),
      "./routes/(admin)/@error.tsx": routeModule({ default: AdminError }),
      "./routes/(admin)/users.tsx": routeModule({ GET: page(View) }),
      "./routes/about.tsx": routeModule({ GET: page(View) }),
    });

    await expect(unstable_loadErrorFallback(manifest, "/users")).resolves.toBe(
      AdminError,
    );
    await expect(unstable_loadErrorFallback(manifest, "/about")).resolves.toBe(
      RootError,
    );
    await expect(unstable_loadErrorFallback(manifest, "/missing")).resolves.toBe(
      RootError,
    );
  });

  it("prefers static routes over dynamic routes", () => {
    const manifest = unstable_createRouteManifest({
      "./routes/blog/[slug].tsx": routeModule({ GET: page(View) }),
      "./routes/blog/archive.tsx": routeModule({ GET: page(View) }),
    });

    const match = unstable_findRouteMatch(manifest.routes, "/blog/archive");

    expect(match?.route.file).toBe("./routes/blog/archive.tsx");
    expect(match?.path).toEqual({});
  });
});
