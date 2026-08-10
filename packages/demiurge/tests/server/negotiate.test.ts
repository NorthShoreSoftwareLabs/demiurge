import { describe, expect, it } from "vitest";
import {
  acceptsHtmlDocument,
  createProblemResponse,
  prefersHtmlDocument,
} from "../../src/server";

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

describe("problem+json responses", () => {
  it("carries the RFC 9457 members and content type", async () => {
    const response = createProblemResponse({
      instance: "/api/widgets/9",
      status: 404,
      title: "Not Found",
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json; charset=utf-8",
    );
    await expect(response.json()).resolves.toEqual({
      instance: "/api/widgets/9",
      status: 404,
      title: "Not Found",
      type: "about:blank",
    });
  });

  // Object spread drops every header from these forms, which is how a caller
  // ends up wondering where their header went.
  it("merges headers given as a Headers instance or tuple array", () => {
    const fromHeaders = createProblemResponse(
      { status: 500, title: "Internal Server Error" },
      { headers: new Headers({ "x-request-id": "abc" }) },
    );
    const fromTuples = createProblemResponse(
      { status: 500, title: "Internal Server Error" },
      { headers: [["x-request-id", "abc"]] },
    );

    expect(fromHeaders.headers.get("x-request-id")).toBe("abc");
    expect(fromTuples.headers.get("x-request-id")).toBe("abc");
  });

  it("refuses to let a caller mislabel the body", () => {
    const response = createProblemResponse(
      { status: 500, title: "Internal Server Error" },
      { headers: { "content-type": "text/html" } },
    );

    expect(response.headers.get("content-type")).toBe(
      "application/problem+json; charset=utf-8",
    );
  });
});
