import { describe, expect, it, vi } from "vitest";
import {
  page,
  unstable_createRouteManifest,
  unstable_findPageMatch,
  unstable_loadRoute,
  unstable_matchSegments,
  unstable_splitPathname,
  unstable_toRouteSegments,
  type LayoutProps,
  type RouteModule,
  type RouteProps,
} from "./router";

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
    const manifest = unstable_createRouteManifest({
      "./routes/@layout.tsx": routeModule({ default: RootLayout }),
      "./routes/blog/@layout.tsx": routeModule({ default: BlogLayout }),
      "./routes/index.tsx": routeModule({ GET: page(View) }),
      "./routes/policy.tsx": routeModule({ GET: page(View) }),
      "./routes/blog/[slug].tsx": routeModule({ GET: page(View) }),
    });

    expect(manifest.layouts.map((layout) => layout.file)).toEqual([
      "./routes/@layout.tsx",
      "./routes/blog/@layout.tsx",
    ]);
    expect(manifest.pages.map((route) => route.file)).toContain(
      "./routes/policy.tsx",
    );
  });

  it("prefers static routes over dynamic routes", () => {
    const manifest = unstable_createRouteManifest({
      "./routes/blog/[slug].tsx": routeModule({ GET: page(View) }),
      "./routes/blog/archive.tsx": routeModule({ GET: page(View) }),
    });

    const match = unstable_findPageMatch(manifest.pages, "/blog/archive");

    expect(match?.page.file).toBe("./routes/blog/archive.tsx");
    expect(match?.path).toEqual({});
  });
});

describe("route loading", () => {
  it("loads the matched page capability and inherited layouts", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/@layout.tsx": routeModule({ default: RootLayout }),
      "./routes/blog/@layout.tsx": routeModule({ default: BlogLayout }),
      "./routes/blog/[slug].tsx": routeModule({ GET: page(View) }),
    });

    const match = await unstable_loadRoute(manifest, "/blog/file-based-routing");

    expect(match.status).toBe("ready");
    if (match.status !== "ready") return;

    expect(match.match.page).toBe(View);
    expect(match.match.path).toEqual({ slug: "file-based-routing" });
    expect(match.match.layouts).toEqual([RootLayout, BlogLayout]);
  });

  it("skips inherited layouts when a page declares layout false", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/@layout.tsx": routeModule({ default: RootLayout }),
      "./routes/embed.tsx": routeModule({
        GET: page({
          layout: false,
          view: View,
        }),
      }),
    });

    const match = await unstable_loadRoute(manifest, "/embed");

    expect(match.status).toBe("ready");
    if (match.status !== "ready") return;

    expect(match.match.layouts).toEqual([]);
  });

  it("treats files without page-compatible GET as not found", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/api/health.tsx": routeModule({}),
    });

    await expect(unstable_loadRoute(manifest, "/api/health")).resolves.toEqual({
      status: "not-found",
      pathname: "/api/health",
    });
  });
});
