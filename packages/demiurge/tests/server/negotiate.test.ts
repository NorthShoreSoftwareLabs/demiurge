import { describe, expect, it } from "vitest";
import { acceptsHtmlDocument, prefersHtmlDocument } from "../../src/server";

describe("not-found content negotiation", () => {
  it("accepts an explicit HTML range", () => {
    expect(acceptsHtmlDocument("text/html")).toBe(true);
    expect(acceptsHtmlDocument("application/xhtml+xml")).toBe(true);
    expect(
      acceptsHtmlDocument(
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ),
    ).toBe(true);
  });

  it("is case and whitespace insensitive", () => {
    expect(acceptsHtmlDocument("  TEXT/HTML ; q=0.4 ")).toBe(true);
  });

  // A bare `*/*` is what curl and most HTTP clients send. Reading it as a
  // request for markup would hand an API client a document it cannot parse.
  it("refuses a wildcard-only header", () => {
    expect(acceptsHtmlDocument("*/*")).toBe(false);
    expect(acceptsHtmlDocument("text/*")).toBe(false);
  });

  it("refuses a missing or empty header", () => {
    expect(acceptsHtmlDocument(null)).toBe(false);
    expect(acceptsHtmlDocument("")).toBe(false);
    expect(acceptsHtmlDocument(",,")).toBe(false);
  });

  it("refuses HTML explicitly weighted to zero", () => {
    expect(acceptsHtmlDocument("text/html;q=0")).toBe(false);
    expect(acceptsHtmlDocument("text/html;q=0,application/json")).toBe(false);
  });

  it("keeps HTML when the quality value is malformed", () => {
    expect(acceptsHtmlDocument("text/html;q=notanumber")).toBe(true);
    expect(acceptsHtmlDocument("text/html;q=")).toBe(true);
  });

  it("refuses machine formats", () => {
    expect(acceptsHtmlDocument("application/json")).toBe(false);
    expect(acceptsHtmlDocument("application/problem+json, */*;q=0.1")).toBe(
      false,
    );
  });

  it("reads the header off a request", () => {
    expect(
      prefersHtmlDocument(
        new Request("https://example.test/", {
          headers: { accept: "text/html" },
        }),
      ),
    ).toBe(true);
    expect(
      prefersHtmlDocument(
        new Request("https://example.test/", {
          headers: { accept: "application/json" },
        }),
      ),
    ).toBe(false);
  });
});
