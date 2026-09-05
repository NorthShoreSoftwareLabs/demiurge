import { describe, expect, it } from "vitest";
import { createMemoryCacheStore, createRequestHandler, json, page, redirect, type RouteModule } from "@demiurgejs/core";

const locales = {
  aliases: { french: "fr" },
  cookie: { name: "locale" },
  defaultLocale: "en",
  path: { labels: { en: "en", fr: "fr" }, reserved: ["de"] },
  supportedLocales: ["en", "fr"],
} as const;

function View() {
  return <main>Localized page</main>;
}

function NotFound() {
  return <main>Localized missing page</main>;
}

// Each route needs an inherited access declaration, because the request
// pipeline denies a route that declares none. A test that does not examine
// authorization declares public access here.
function routeModule(module: RouteModule) {
  return async () => ({
    ...module,
    policy: { access: { public: true }, ...module.policy },
  });
}

function handler() {
  return createRequestHandler({
    locales,
    routes: {
      "./routes/@not-found.tsx": routeModule({ default: NotFound }),
      "./routes/index.tsx": routeModule({
        GET: page(View),
        metadata: ({ locale }) => ({
          description: locale === "fr" ? "Page française" : "English page",
          title: locale === "fr" ? "Français" : "English",
        }),
      }),
      "./routes/api.ts": routeModule({ GET: json({ ok: true }) }),
      "./routes/redirect.ts": routeModule({ GET: redirect("/") }),
    },
  });
}

describe("localized request routing", () => {
  it("matches a page after it removes the locale prefix", async () => {
    const response = await handler()(new Request("https://example.test/fr"));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Localized page");
    expect(body).toContain('"locale":"fr"');
    expect(body).toContain('<html lang="fr" dir="ltr">');
    expect(body).toContain("<title>Français</title>");
    expect(body).toContain('content="Page française"');
    expect(body).toContain('<link data-demiurge-document-contribution rel="canonical" href="https://example.test/fr" />');
    expect(body).toContain('rel="alternate" href="https://example.test/" hreflang="en"');
    expect(body).toContain('rel="alternate" href="https://example.test/fr" hreflang="fr"');
  });

  it("uses a permanent redirect for an alias", async () => {
    const response = await handler()(new Request("https://example.test/french?q=1"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://example.test/fr?q=1");
  });

  it("uses a private temporary redirect for a preference", async () => {
    const response = await handler()(new Request("https://example.test/", {
      headers: { cookie: "locale=fr" },
    }));
    expect(response.status).toBe(307);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
  });

  it("renders not found for a reserved locale label", async () => {
    const response = await handler()(new Request("https://example.test/de", {
      headers: { accept: "text/html" },
    }));
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toContain("Localized missing page");
  });

  it("does not preference-redirect a resource route", async () => {
    const response = await handler()(new Request("https://example.test/api", {
      headers: { cookie: "locale=fr" },
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("localizes same-origin route redirects", async () => {
    const response = await handler()(new Request("https://example.test/fr/redirect"));
    expect(response.headers.get("location")).toBe("/fr");
  });

  it("isolates framework cache identity by locale", async () => {
    let loads = 0;
    const handle = createRequestHandler({
      cacheStore: {
        namespace: { app: "locale-test", environment: "test", schemaVersion: 1 },
        store: createMemoryCacheStore(),
      },
      locales,
      routes: {
        "./routes/@not-found.tsx": routeModule({ default: NotFound }),
        "./routes/index.tsx": routeModule({
          GET: page({
            data: async ({ cache }) => await cache.get({
              fn: async () => ({ loads: ++loads }),
              key: ["home"],
              scope: "public",
            }),
            view: View,
          }),
        }),
      },
    });

    await handle(new Request("https://example.test/"));
    await handle(new Request("https://example.test/fr"));
    await handle(new Request("https://example.test/"));
    await handle(new Request("https://example.test/fr"));

    expect(loads).toBe(2);
  });
});
