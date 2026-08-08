import { describe, expect, it, vi } from "vitest";
import {
  json,
  page,
  type LayoutProps,
  type RouteModule,
  type RouteProps,
} from "demiurge";
import {
  unstable_createRouteManifest,
  unstable_loadPageRoute,
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

describe("route loading", () => {
  it("loads the matched page capability and inherited layouts", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/@layout.tsx": routeModule({ default: RootLayout }),
      "./routes/blog/@layout.tsx": routeModule({ default: BlogLayout }),
      "./routes/blog/[slug].tsx": routeModule({ GET: page(View) }),
    });

    const match = await unstable_loadPageRoute(
      manifest,
      "/blog/file-based-routing",
    );

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

    const match = await unstable_loadPageRoute(manifest, "/embed");

    expect(match.status).toBe("ready");
    if (match.status !== "ready") return;

    expect(match.match.layouts).toEqual([]);
  });

  it("uses route groups for organization without adding URL segments", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/@layout.tsx": routeModule({ default: RootLayout }),
      "./routes/(admin)/@layout.tsx": routeModule({ default: BlogLayout }),
      "./routes/(admin)/users.tsx": routeModule({ GET: page(View) }),
    });

    const match = await unstable_loadPageRoute(manifest, "/users");

    expect(match.status).toBe("ready");
    if (match.status !== "ready") return;

    expect(match.match.page).toBe(View);
    expect(match.match.layouts).toEqual([RootLayout, BlogLayout]);
  });

  it("treats files without page-compatible GET as not found", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/api/health.tsx": routeModule({
        GET: json({ ok: true }),
      }),
    });

    await expect(
      unstable_loadPageRoute(manifest, "/api/health"),
    ).resolves.toEqual({
      status: "not-found",
      pathname: "/api/health",
    });
  });
});
