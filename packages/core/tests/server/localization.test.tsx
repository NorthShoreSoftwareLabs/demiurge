import { describe, expect, it } from "vitest";
import { createRequestHandler, json, page, redirect, type RouteModule } from "@demiurgejs/core";

const locales = {
  aliases: { french: "fr" },
  cookie: { name: "locale" },
  defaultLocale: "en",
  directions: { fr: "rtl" },
  path: { labels: { en: "en", fr: "fr" }, reserved: ["de"] },
  supportedLocales: ["en", "fr"],
} as const;

function View() {
  return <main>Localized page</main>;
}

function NotFound() {
  return <main>Localized missing page</main>;
}

function Broken(): never {
  throw new Error("Localized render failed");
}

function ErrorView() {
  return <main>Localized error page</main>;
}

function routeModule(module: RouteModule) {
  return async () => module;
}

function handler() {
  return createRequestHandler({
    locales,
    routes: {
      "./routes/@not-found.tsx": routeModule({ default: NotFound }),
      "./routes/@error.tsx": routeModule({ default: ErrorView }),
      "./routes/broken.tsx": routeModule({ GET: page(Broken) }),
      "./routes/index.tsx": routeModule({ GET: page(View) }),
      "./routes/api.ts": routeModule({ GET: json({ ok: true }) }),
      "./routes/redirect.ts": routeModule({ GET: redirect("/") }),
      "./routes/static.tsx": routeModule({
        GET: page({ render: { mode: "static" }, view: View }),
      }),
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
    expect(body).toContain('<html lang="fr" dir="rtl">');
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
    const body = await response.text();
    expect(body).toContain("Localized missing page");
    expect(body).toContain('<html lang="en" dir="ltr">');
  });

  it("applies the resolved values to localized error documents", async () => {
    const response = await handler()(new Request("https://example.test/fr/broken"));
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain("Localized error page");
    expect(body).toContain('<html lang="fr" dir="rtl">');
  });

  it("includes the resolved values in browser navigation data", async () => {
    const response = await handler()(new Request("https://example.test/fr", {
      headers: { "x-demiurge-navigation": "data" },
    }));

    await expect(response.json()).resolves.toMatchObject({
      document: { dir: "rtl", lang: "fr" },
      locale: "fr",
    });
  });

  it("renders deterministic static document attributes", async () => {
    const request = () => new Request("https://example.test/fr/static");
    const first = await (await handler()(request())).text();
    const second = await (await handler()(request())).text();

    expect(first).toBe(second);
    expect(first).toContain('<html lang="fr" dir="rtl">');
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
});
