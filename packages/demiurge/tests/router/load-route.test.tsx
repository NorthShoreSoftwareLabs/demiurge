import { describe, expect, it, vi } from "vitest";
import {
  defineLinks,
  defineMetadata,
  defineScripts,
  json,
  modulePreload,
  page,
  preconnect,
  preload,
  script,
  query,
  resolveMetadata,
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

function AboutView(_props: RouteProps) {
  return null;
}

type PostData = {
  first: {
    slug: string;
    title: string;
  };
  second: {
    slug: string;
    title: string;
  };
};

function DataView(_props: RouteProps<string, PostData>) {
  return null;
}

function RootLayout(_props: LayoutProps) {
  return null;
}

function BlogLayout(_props: LayoutProps) {
  return null;
}

function RootNotFound() {
  return null;
}

function BlogNotFound() {
  return null;
}

function routeModule(module: RouteModule) {
  return vi.fn(async () => module);
}

describe("route loading", () => {
  it("loads the matched page capability and inherited layouts", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/@layout.tsx": routeModule({
        default: RootLayout,
        links: defineLinks([
          preconnect("https://api.example.com"),
          preload("/root.css", { as: "style" }),
        ]),
        metadata: defineMetadata({
          description: "Root description",
          title: {
            default: "Demiurge",
            format: (title) => `${title} | Demiurge`,
          },
        }),
        scripts: defineScripts([
          script({
            src: "https://cdn.example.com/root.js",
            strategy: "beforeInteractive",
          }),
        ]),
      }),
      "./routes/blog/@layout.tsx": routeModule({
        default: BlogLayout,
        links: defineLinks([
          modulePreload("/assets/blog-editor.js"),
        ]),
        metadata: defineMetadata({
          openGraph: {
            image: "/blog-og.png",
          },
        }),
        scripts: defineScripts([
          script({
            src: "https://cdn.example.com/blog.js",
          }),
        ]),
      }),
      "./routes/blog/[slug].tsx": routeModule({
        GET: page(View),
        links: defineLinks([
          preload("/root.css", { as: "style" }),
          preload("/post.avif", { as: "image", type: "image/avif" }),
        ]),
        metadata: defineMetadata({
          title: "File based routing",
        }),
        scripts: defineScripts([
          script({
            src: "https://cdn.example.com/blog.js",
          }),
          script({
            src: "https://cdn.example.com/post.js",
            strategy: "idle",
          }),
        ]),
      }),
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
    expect(match.match.links).toEqual([
      {
        href: "https://api.example.com",
        kind: "link",
        rel: "preconnect",
      },
      {
        as: "image",
        href: "/post.avif",
        kind: "link",
        rel: "preload",
        type: "image/avif",
      },
      {
        as: "style",
        href: "/root.css",
        kind: "link",
        rel: "preload",
      },
      {
        href: "/assets/blog-editor.js",
        kind: "link",
        rel: "modulepreload",
      },
    ]);
    expect(match.match.metadata).toMatchObject({
      description: "Root description",
      openGraph: {
        description: "Root description",
        image: "/blog-og.png",
        title: "File based routing | Demiurge",
      },
      title: "File based routing | Demiurge",
    });
    expect(match.match.scripts).toEqual([
      {
        kind: "script",
        src: "https://cdn.example.com/root.js",
        strategy: "beforeInteractive",
      },
      {
        kind: "script",
        src: "https://cdn.example.com/blog.js",
        strategy: "afterInteractive",
      },
      {
        kind: "script",
        src: "https://cdn.example.com/post.js",
        strategy: "idle",
      },
    ]);
  });

  it("resolves request-aware document contributions with the matched request", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/checkout.tsx": routeModule({
        GET: page(View),
        links: defineLinks(({ search }) =>
          search.get("hero") === "true"
            ? [preload("/checkout.avif", { as: "image" })]
            : [],
        ),
        scripts: defineScripts(({ search }) =>
          search.get("payment") === "true"
            ? [
                script({
                  src: "https://js.stripe.com/v3/",
                  strategy: "beforeInteractive",
                }),
              ]
            : [],
        ),
      }),
    });

    const match = await unstable_loadPageRoute(
      manifest,
      "/checkout",
      new Request("https://example.test/checkout?hero=true&payment=true"),
    );

    expect(match.status).toBe("ready");
    if (match.status !== "ready") return;

    expect(match.match.links).toEqual([
      {
        as: "image",
        href: "/checkout.avif",
        kind: "link",
        rel: "preload",
      },
    ]);
    expect(match.match.scripts).toEqual([
      {
        kind: "script",
        src: "https://js.stripe.com/v3/",
        strategy: "beforeInteractive",
      },
    ]);
  });

  it("resolves route-level page data with the matched request and cache", async () => {
    const loadPost = vi.fn(async (slug: string) => ({
      slug,
      title: "File based routing",
    }));
    const postBySlug = query({
      fn: loadPost,
      key: (slug: string) => ["post", slug],
      scope: "request",
    });
    const manifest = unstable_createRouteManifest({
      "./routes/blog/[slug].tsx": routeModule({
        GET: page({
          data: async ({ cache, path }) => ({
            first: await cache.get(postBySlug(path.slug)),
            second: await cache.get(postBySlug(path.slug)),
          }),
          view: DataView,
        }),
      }),
    });

    const match = await unstable_loadPageRoute(
      manifest,
      "/blog/file-based-routing",
    );

    expect(match.status).toBe("ready");
    if (match.status !== "ready") return;

    expect(match.match.data).toEqual({
      first: {
        slug: "file-based-routing",
        title: "File based routing",
      },
      second: {
        slug: "file-based-routing",
        title: "File based routing",
      },
    });
    expect(loadPost).toHaveBeenCalledTimes(1);
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
      "./routes/about.tsx": routeModule({ GET: page(AboutView) }),
    });

    const match = await unstable_loadPageRoute(manifest, "/users");

    expect(match.status).toBe("ready");
    if (match.status !== "ready") return;

    expect(match.match.page).toBe(View);
    expect(match.match.layouts).toEqual([RootLayout, BlogLayout]);

    const siblingMatch = await unstable_loadPageRoute(manifest, "/about");

    expect(siblingMatch.status).toBe("ready");
    if (siblingMatch.status !== "ready") return;

    expect(siblingMatch.match.page).toBe(AboutView);
    expect(siblingMatch.match.layouts).toEqual([RootLayout]);
  });

  it("treats files without page-compatible GET as not found", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/@not-found.tsx": routeModule({ default: RootNotFound }),
      "./routes/api/health.tsx": routeModule({
        GET: json({ ok: true }),
      }),
    });

    await expect(
      unstable_loadPageRoute(manifest, "/api/health"),
    ).resolves.toEqual({
      layouts: [],
      metadata: resolveMetadata(),
      notFound: RootNotFound,
      pathname: "/api/health",
      status: "not-found",
    });
  });

  it("loads the closest not-found fallback for missing paths", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/@not-found.tsx": routeModule({ default: RootNotFound }),
      "./routes/blog/@not-found.tsx": routeModule({ default: BlogNotFound }),
    });

    await expect(unstable_loadPageRoute(manifest, "/blog/missing")).resolves.toEqual({
      layouts: [],
      metadata: resolveMetadata(),
      notFound: BlogNotFound,
      pathname: "/blog/missing",
      status: "not-found",
    });
    await expect(unstable_loadPageRoute(manifest, "/missing")).resolves.toEqual({
      layouts: [],
      metadata: resolveMetadata(),
      notFound: RootNotFound,
      pathname: "/missing",
      status: "not-found",
    });
  });
});
