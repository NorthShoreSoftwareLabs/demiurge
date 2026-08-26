import { describe, expect, it } from "vitest";
import { createRequestHandler, page, type RouteModule } from "@demiurgejs/core";

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

function routeModule(module: RouteModule) {
  return async () => module;
}

function handler() {
  return createRequestHandler({
    locales,
    routes: {
      "./routes/@not-found.tsx": routeModule({ default: NotFound }),
      "./routes/index.tsx": routeModule({ GET: page(View) }),
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
});
