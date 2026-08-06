import { describe, expect, it, vi } from "vitest";
import { json, page, redirect, type RouteModule, type RouteProps } from "demiurge";
import { unstable_createRouteManifest } from "demiurge/internal/testing";
import { unstable_handleDevRequest } from "demiurge/vite";

function View(_props: RouteProps) {
  return null;
}

function routeModule(module: RouteModule) {
  return vi.fn(async () => module);
}

describe("Vite plugin dev request handling", () => {
  it("serves HTTP response capabilities", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/api/health.tsx": routeModule({
        GET: json({ ok: true }),
      }),
    });

    const result = await unstable_handleDevRequest(
      manifest,
      new Request("https://example.test/api/health"),
    );

    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) return;

    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual({ ok: true });
  });

  it("serves redirects", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/old-blog.tsx": routeModule({
        GET: redirect("/blog", 301),
      }),
    });

    const result = await unstable_handleDevRequest(
      manifest,
      new Request("https://example.test/old-blog"),
    );

    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) return;

    expect(result.status).toBe(301);
    expect(result.headers.get("location")).toBe("/blog");
  });

  it("falls through page routes to the browser app", async () => {
    const manifest = unstable_createRouteManifest({
      "./routes/index.tsx": routeModule({
        GET: page(View),
      }),
    });

    await expect(
      unstable_handleDevRequest(
        manifest,
        new Request("https://example.test/"),
      ),
    ).resolves.toBe("next");
  });

  it("falls through unmatched routes to Vite", async () => {
    const manifest = unstable_createRouteManifest({});

    await expect(
      unstable_handleDevRequest(
        manifest,
        new Request("https://example.test/missing"),
      ),
    ).resolves.toBe("next");
  });
});
