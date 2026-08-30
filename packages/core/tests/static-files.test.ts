import { describe, expect, it } from "vitest";
import {
  contentTypeForExtension,
  DEFAULT_CONTENT_TYPE,
} from "../src/static-files";

describe("contentTypeForExtension", () => {
  it("accepts an extension with or without the leading dot", () => {
    expect(contentTypeForExtension(".css")).toBe("text/css; charset=utf-8");
    expect(contentTypeForExtension("css")).toBe("text/css; charset=utf-8");
  });

  it("ignores letter case", () => {
    expect(contentTypeForExtension(".PNG")).toBe("image/png");
    expect(contentTypeForExtension("WOFF2")).toBe("font/woff2");
  });

  it("names the common web asset types", () => {
    expect(contentTypeForExtension(".html")).toBe("text/html; charset=utf-8");
    expect(contentTypeForExtension(".js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeForExtension(".mjs")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeForExtension(".json")).toBe("application/json; charset=utf-8");
    expect(contentTypeForExtension(".map")).toBe("application/json; charset=utf-8");
    expect(contentTypeForExtension(".svg")).toBe("image/svg+xml");
    expect(contentTypeForExtension(".webmanifest")).toBe("application/manifest+json");
    expect(contentTypeForExtension(".wasm")).toBe("application/wasm");
    expect(contentTypeForExtension(".mp4")).toBe("video/mp4");
  });

  it("falls back to an opaque type for an unlisted or empty extension", () => {
    expect(contentTypeForExtension(".bin")).toBe(DEFAULT_CONTENT_TYPE);
    expect(contentTypeForExtension("")).toBe(DEFAULT_CONTENT_TYPE);
    expect(contentTypeForExtension(".")).toBe(DEFAULT_CONTENT_TYPE);
  });
});
