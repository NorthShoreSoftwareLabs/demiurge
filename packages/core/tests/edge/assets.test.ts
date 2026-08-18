import { describe, expect, it } from "vitest";
import { createEdgeAssetHandler } from "@demiurgejs/core/edge";

const origin = "https://edge.assets.test";

function get(pathname: string, headers?: Record<string, string>) {
  return new Request(`${origin}${pathname}`, { headers });
}

const handler = createEdgeAssetHandler({
  assets: {
    "/assets/app-abcdef12.js": { body: "export const app = 1;\n" },
    "/assets/style.css": { body: "body { color: red }\n" },
    "/demiurge-manifest.json": { body: "{}" },
    "/favicon.ico": { body: new Uint8Array([0, 0, 1, 0]) },
    "/index.html": { body: "<!doctype html>" },
    "/report": { body: "no extension" },
    "styles/theme.css": { body: "body { color: blue }\n" },
  },
});

describe("createEdgeAssetHandler", () => {
  it("serves a declared asset without touching a filesystem", async () => {
    const response = await handler(get("/assets/app-abcdef12.js"));

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(response?.headers.get("content-length")).toBe("22");
    expect(response?.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response?.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
    expect(await response?.text()).toBe("export const app = 1;\n");
  });

  it("marks a content-hashed file immutable and revalidates the rest", async () => {
    const hashed = await handler(get("/assets/app-abcdef12.js"));
    const plain = await handler(get("/assets/style.css"));

    expect(hashed?.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(plain?.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
  });

  it("normalizes a declared pathname that omits the leading slash", async () => {
    expect((await handler(get("/styles/theme.css")))?.status).toBe(200);
  });

  it("answers a matching conditional request with 304", async () => {
    const first = await handler(get("/assets/style.css"));
    const etag = first?.headers.get("etag") ?? "";
    const revalidated = await handler(
      get("/assets/style.css", { "if-none-match": etag }),
    );
    const wildcard = await handler(
      get("/assets/style.css", { "if-none-match": "*" }),
    );
    const other = await handler(
      get("/assets/style.css", { "if-none-match": 'W/"other"' }),
    );

    expect(etag).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);
    expect(revalidated?.status).toBe(304);
    expect(revalidated?.headers.has("content-length")).toBe(false);
    expect(wildcard?.status).toBe(304);
    expect(other?.status).toBe(200);
  });

  it("derives the same validator from the same bytes", async () => {
    const other = createEdgeAssetHandler({
      assets: { "/assets/style.css": { body: "body { color: red }\n" } },
    });
    const left = await handler(get("/assets/style.css"));
    const right = await other(get("/assets/style.css"));

    expect(left?.headers.get("etag")).toBe(right?.headers.get("etag"));
  });

  it("answers HEAD with the headers and no body", async () => {
    const response = await handler(
      new Request(`${origin}/assets/style.css`, { method: "HEAD" }),
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-length")).toBe("20");
    expect(response?.body).toBeNull();
  });

  it("returns null for anything the map does not declare", async () => {
    expect(await handler(get("/missing.js"))).toBeNull();
    expect(await handler(get("/assets/"))).toBeNull();
    expect(await handler(get("/assets/%2e%2e/secret.js"))).toBeNull();
    expect(await handler(get("/assets/%ZZ"))).toBeNull();
    expect(
      await handler(
        new Request(`${origin}/assets/style.css`, { method: "POST" }),
      ),
    ).toBeNull();
  });

  it("never serves the framework build output", async () => {
    expect(await handler(get("/index.html"))).toBeNull();
    expect(await handler(get("/demiurge-manifest.json"))).toBeNull();
  });

  it("falls back to an opaque content type", async () => {
    const response = await handler(get("/report"));

    expect(response?.headers.get("content-type")).toBe(
      "application/octet-stream",
    );
  });

  it("serves binary bodies and honors an explicit content type", async () => {
    const icon = await handler(get("/favicon.ico"));
    const buffered = createEdgeAssetHandler({
      assets: {
        "/data.bin": {
          body: new Uint8Array([1, 2, 3]).buffer,
          contentType: "application/wasm",
          immutable: true,
        },
      },
    });
    const response = await buffered(get("/data.bin"));

    expect(icon?.headers.get("content-type")).toBe("image/x-icon");
    expect(response?.headers.get("content-type")).toBe("application/wasm");
    expect(response?.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("serves a prefixed mount and ignores anything outside it", async () => {
    const prefixed = createEdgeAssetHandler({
      assets: { "/app.js": { body: "export {};\n" } },
      immutable: () => true,
      prefix: "/static",
    });

    expect((await prefixed(get("/static/app.js")))?.status).toBe(200);
    expect((await prefixed(get("/static/app.js")))?.headers.get("cache-control"))
      .toBe("public, max-age=31536000, immutable");
    expect(await prefixed(get("/app.js"))).toBeNull();
  });

  it("treats a root prefix as no prefix", async () => {
    const rooted = createEdgeAssetHandler({
      assets: { "/app.js": { body: "export {};\n" } },
      prefix: "/",
    });

    expect((await rooted(get("/app.js")))?.status).toBe(200);
  });
});
