import { describe, expect, it, vi } from "vitest";
import {
  page,
  unstable_createRouteManifest,
  unstable_loadRoute,
  type LayoutProps,
  type RouteModule,
  type RouteProps,
} from "@demiurge/router";

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
