import { describe, expect, it, vi } from "vitest";
import {
  page,
  query,
  type LayoutProps,
  type RouteModule,
  type RoutePolicy,
  type RouteProps,
} from "@demiurgejs/core";
import {
  unstable_collectStaticRoutePaths,
  unstable_createRouteManifest,
  unstable_findRouteMatch,
  unstable_loadErrorFallback,
  unstable_loadLoadingFallback,
  unstable_matchSegments,
  unstable_splitPathname,
  unstable_toRouteSegments,
} from "@demiurgejs/core/internal/testing";

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

  it("decodes segments after preserving encoded slash boundaries", () => {
    expect(unstable_splitPathname("/caf%C3%A9/hello%20world/a%2Fb/%25")).toEqual([
      "café",
      "hello world",
      "a/b",
      "%",
    ]);
  });

  it("rejects malformed percent encoding deterministically", () => {
    expect(() => unstable_splitPathname("/bad/%")).toThrow(
      /Malformed percent encoding/,
    );
  });

  it("matches static, dynamic, and catchall path variables", () => {
    expect(unstable_matchSegments(["blog"], ["blog"])).toEqual({});
    expect(
      unstable_matchSegments(["blog", ":slug"], ["blog", "hello world"]),
    ).toEqual({ slug: "hello world" });
    expect(unstable_matchSegments(["docs", "*path"], ["docs", "a", "b"]))
      .toEqual({ path: "a/b" });
    expect(unstable_matchSegments(["blog"], ["blog", "extra"])).toBeNull();
  });

  it("matches encoded runtime URLs consistently across route shapes", () => {
    const manifest = unstable_createRouteManifest({
      "./routes/café.tsx": routeModule({ GET: page(View) }),
      "./routes/posts/[slug].tsx": routeModule({ GET: page(View) }),
      "./routes/files/[...path].tsx": routeModule({ GET: page(View) }),
    });

    expect(unstable_findRouteMatch(manifest.routes, "/caf%C3%A9")?.path)
      .toEqual({});
    expect(
      unstable_findRouteMatch(manifest.routes, "/posts/a%2Fb")?.path,
    ).toEqual({ slug: "a/b" });
    expect(
      unstable_findRouteMatch(manifest.routes, "/files/caf%C3%A9/a%2Fb")?.path,
    ).toEqual({ path: "café/a/b" });
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

  it("rejects dynamic routes with the same runtime shape", () => {
    expect(() =>
      unstable_createRouteManifest({
        "./routes/users/[id].tsx": routeModule({ GET: page(View) }),
        "./routes/users/[slug].tsx": routeModule({ GET: page(View) }),
      }),
    ).toThrow(
      'Ambiguous routes "./routes/users/[id].tsx" and "./routes/users/[slug].tsx" have the same runtime shape and both match "/users/example".',
    );
  });

  it("rejects catchall aliases and route-group collisions", () => {
    expect(() =>
      unstable_createRouteManifest({
        "./routes/docs/[...parts].tsx": routeModule({ GET: page(View) }),
        "./routes/docs/[...path].tsx": routeModule({ GET: page(View) }),
      }),
    ).toThrow('both match "/docs/example"');
    expect(() =>
      unstable_createRouteManifest({
        "./routes/(admin)/settings.tsx": routeModule({ GET: page(View) }),
        "./routes/(public)/settings.tsx": routeModule({ GET: page(View) }),
      }),
    ).toThrow('both match "/settings"');
  });

  it("uses positional specificity instead of filename order", () => {
    const manifest = unstable_createRouteManifest({
      "./routes/[org]/settings.tsx": routeModule({ GET: page(View) }),
      "./routes/users/[page].tsx": routeModule({ GET: page(View) }),
    });

    expect(
      unstable_findRouteMatch(manifest.routes, "/users/settings")?.route.file,
    ).toBe("./routes/users/[page].tsx");
  });

  it("requires catchall variables to be the final URL segment", () => {
    expect(() =>
      unstable_createRouteManifest({
        "./routes/docs/[...path]/edit.tsx": routeModule({ GET: page(View) }),
      }),
    ).toThrow(
      'Catchall route segment in "./routes/docs/[...path]/edit.tsx" must be the final URL segment.',
    );
  });

  it("collects concrete static paths for static, dynamic, and catchall page routes", async () => {
    const loadSlugs = vi.fn(async () => ["hello world", "file-routing"]);
    const slugsQuery = query({
      fn: loadSlugs,
      key: () => ["static", "slugs"],
      scope: "build",
    });
    const manifest = unstable_createRouteManifest({
      "./routes/(marketing)/about.tsx": routeModule({
        GET: page({ render: { mode: "static" }, view: View }),
      }),
      "./routes/blog/[slug].tsx": routeModule({
        GET: page({ render: { mode: "static" }, view: View }),
        paths: async ({ cache }) =>
          (await cache.get(slugsQuery())).map((slug) => ({ slug })),
      }),
      "./routes/docs/[...path].tsx": routeModule({
        GET: page({ render: { mode: "static" }, view: View }),
        paths: async () => [
          { path: "guide/intro" },
          { path: "api reference/routes" },
        ],
      }),
      "./routes/api/[id].tsx": routeModule({}),
    });

    await expect(unstable_collectStaticRoutePaths(manifest)).resolves.toEqual([
      {
        file: "./routes/(marketing)/about.tsx",
        path: {},
        pattern: "/about",
        pathname: "/about",
      },
      {
        file: "./routes/blog/[slug].tsx",
        path: { slug: "hello world" },
        pattern: "/blog/[slug]",
        pathname: "/blog/hello%20world",
      },
      {
        file: "./routes/blog/[slug].tsx",
        path: { slug: "file-routing" },
        pattern: "/blog/[slug]",
        pathname: "/blog/file-routing",
      },
      {
        file: "./routes/docs/[...path].tsx",
        path: { path: "guide/intro" },
        pattern: "/docs/[...path]",
        pathname: "/docs/guide/intro",
      },
      {
        file: "./routes/docs/[...path].tsx",
        path: { path: "api reference/routes" },
        pattern: "/docs/[...path]",
        pathname: "/docs/api%20reference/routes",
      },
    ]);
    expect(loadSlugs).toHaveBeenCalledTimes(1);
  });

  it("requires dynamic page routes to export static paths", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/blog/[slug].tsx": routeModule({
        GET: page({ render: { mode: "static" }, view: View }),
      }),
    });

    await expect(unstable_collectStaticRoutePaths(manifest)).rejects.toThrow(
      'Dynamic static route "./routes/blog/[slug].tsx" must export paths for "/blog/[slug]".',
    );
  });

  it("validates static path entries against route variables", async () => {
    const missingPathManifest = unstable_createRouteManifest({
      "./routes/blog/[slug].tsx": routeModule({
        GET: page({ render: { mode: "static" }, view: View }),
        paths: async () => [{}],
      }),
    });
    const invalidPathManifest = unstable_createRouteManifest({
      "./routes/blog/[slug].tsx": routeModule({
        GET: page({ render: { mode: "static" }, view: View }),
        paths: async () => [{ slug: { nested: true } as never }],
      }),
    });

    await expect(
      unstable_collectStaticRoutePaths(missingPathManifest),
    ).rejects.toThrow(
      'Static paths for "./routes/blog/[slug].tsx" must include "slug" for "/blog/[slug]".',
    );
    await expect(
      unstable_collectStaticRoutePaths(invalidPathManifest),
    ).rejects.toThrow(
      'Static path "slug" for "./routes/blog/[slug].tsx" must be a string, number, or boolean.',
    );
  });

  it("rejects runtime page routes when collecting static output", async () => {
    const ssrManifest = unstable_createRouteManifest({
      "./routes/account.tsx": routeModule({ GET: page(View) }),
    });
    const streamingManifest = unstable_createRouteManifest({
      "./routes/feed.tsx": routeModule({
        GET: page({ render: { mode: "streaming" }, view: View }),
      }),
    });

    await expect(unstable_collectStaticRoutePaths(ssrManifest)).rejects.toThrow(
      'Page route "./routes/account.tsx" uses render mode "ssr" and cannot be emitted as static output. Set render: { mode: "static" } or deploy a runtime adapter.',
    );
    await expect(
      unstable_collectStaticRoutePaths(streamingManifest),
    ).rejects.toThrow(
      'Page route "./routes/feed.tsx" uses render mode "streaming" and cannot be emitted as static output. Set render: { mode: "static" } or deploy a runtime adapter.',
    );
  });
});
