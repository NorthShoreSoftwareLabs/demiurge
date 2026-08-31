import { describe, expect, it } from "vitest";
import { urlExtension, urlPath } from "../../src/platform/url";

describe("urlPath", () => {
  it("drops the query string from a path", () => {
    expect(urlPath("/images/logo.png?width=200")).toBe("/images/logo.png");
  });

  it("drops the fragment from a path", () => {
    expect(urlPath("/docs/intro#setup")).toBe("/docs/intro");
  });

  it("drops both a query string and a fragment, query first", () => {
    expect(urlPath("/docs/intro?ref=nav#setup")).toBe("/docs/intro");
  });

  it("leaves a path with no query string or fragment unchanged", () => {
    expect(urlPath("/docs/intro")).toBe("/docs/intro");
  });
});

describe("urlExtension", () => {
  it("resolves the lower-cased extension of a file name", () => {
    expect(urlExtension("/fonts/brand.WOFF2")).toBe("woff2");
  });

  it("returns an empty string for a name with no dot", () => {
    expect(urlExtension("/fonts/brand")).toBe("");
  });

  it("ignores a dot in a directory name when the file has none", () => {
    expect(urlExtension("/fonts.new/brand")).toBe("");
  });

  it("ignores the query string when resolving the extension", () => {
    expect(urlExtension("/images/logo.png?width=200")).toBe("png");
  });
});
