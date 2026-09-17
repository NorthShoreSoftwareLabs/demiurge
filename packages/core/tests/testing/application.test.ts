import { describe, expect, it, vi } from "vitest";
import {
  assertDocument,
  assertSecurity,
  createApplicationTest,
  createTestClock,
  createTestRequest,
} from "../../src/testing";
import { text } from "../../src/route";

describe("createApplicationTest", () => {
  it("creates standard requests at the application test origin", () => {
    const request = createTestRequest("/messages", {
      headers: { "x-test": "fixture" },
      method: "POST",
    });

    expect(request).toBeInstanceOf(Request);
    expect(request.method).toBe("POST");
    expect(request.headers.get("x-test")).toBe("fixture");
    expect(request.url).toBe("https://demiurge.test/messages");
  });

  it("creates a deterministic clock", () => {
    const clock = createTestClock(1_000);

    expect(clock.now()).toBe(1_000);
    expect(clock.advance(250)).toBe(1_250);
    expect(clock.set(500)).toBe(500);
    expect(() => clock.advance(Number.POSITIVE_INFINITY)).toThrow(
      "Demiurge test clock advance must be finite.",
    );
  });

  it("passes a pathname through the supplied production handler", async () => {
    const handler = vi.fn(async (request: Request) => new Response(request.url));
    const application = createApplicationTest(handler);

    const response = await application.request("/health?deep=true");

    await expect(response.text()).resolves.toBe("https://demiurge.test/health?deep=true");
    expect(handler).toHaveBeenCalledWith(expect.any(Request));
  });

  it("keeps a supplied request unchanged", async () => {
    const request = new Request("https://consumer.test/messages", { method: "POST" });
    const application = createApplicationTest(async (received) => new Response(received.method));

    const response = await application.request(request);

    await expect(response.text()).resolves.toBe("POST");
  });

  it("creates the production route pipeline from handler options", async () => {
    const middleware = vi.fn(async (_context, next) => await next());
    const application = createApplicationTest({
      routes: {
        "./routes/messages.ts": async () => ({
          GET: text("message"),
          policy: { access: { public: true } },
        }),
        "./routes/@middleware.ts": async () => ({ middleware }),
      },
    });

    const response = await application.request(new URL("/messages", "https://consumer.test"));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("message");
    expect(middleware).toHaveBeenCalledOnce();
  });
});

describe("document and security assertions", () => {
  const document = '<title>Reports</title><script data-demiurge-document-contribution data-demiurge-script-strategy="afterInteractive" src="/assets/reports.js" nonce="fresh"></script>';

  it("asserts resolved document metadata and managed scripts", async () => {
    await expect(assertDocument(new Response(document), {
      scripts: [{ src: "/assets/reports.js", strategy: "afterInteractive" }],
      title: "Reports",
    })).resolves.toBeUndefined();
  });

  it("reports a missing managed script contract", async () => {
    await expect(assertDocument(new Response(document), {
      scripts: [{ src: "/assets/missing.js" }],
    })).rejects.toThrow("framework-managed script");
  });

  it("reads an escaped single-quoted managed script source", async () => {
    const escaped = "<script data-demiurge-document-contribution src='/assets/reports.js?a=1&amp;b=2'></script>";

    await expect(assertDocument(new Response(escaped), {
      scripts: [{ src: "/assets/reports.js?a=1&b=2" }],
    })).resolves.toBeUndefined();
  });

  it("reports a managed script that does not match the expected contract", async () => {
    await expect(assertDocument(new Response(document), {
      scripts: [{ strategy: "idle" }],
    })).rejects.toThrow("matching framework-managed script");
  });

  it("asserts a nonce-backed strict policy and private cache", async () => {
    const response = new Response(document, {
      headers: {
        "cache-control": "private, no-store",
        "content-security-policy": "script-src 'nonce-fresh'",
        "x-content-type-options": "nosniff",
      },
    });

    await expect(assertSecurity(response, {
      csp: /nonce-fresh/,
      headers: { "x-content-type-options": "nosniff" },
      nonce: true,
    })).resolves.toBeUndefined();
  });

  it("reports an unsafe nonce cache policy", async () => {
    const response = new Response(document, {
      headers: { "content-security-policy": "script-src 'nonce-fresh'" },
    });

    await expect(assertSecurity(response, { nonce: true })).rejects.toThrow("private or no-store");
  });

  it("accepts a static policy with no document nonce", async () => {
    const response = new Response("<title>Static</title>", {
      headers: { "cache-control": "public, max-age=0, must-revalidate" },
    });

    await expect(assertSecurity(response, {
      cacheControl: "public, max-age=0, must-revalidate",
      nonce: false,
    })).resolves.toBeUndefined();
  });

  it("reports a nonce missing from the CSP header", async () => {
    const response = new Response(document, {
      headers: { "cache-control": "private, no-store", "content-security-policy": "script-src 'self'" },
    });

    await expect(assertSecurity(response, { nonce: true })).rejects.toThrow("absent from the Content-Security-Policy");
  });

  it("reports an unexpected document nonce", async () => {
    const response = new Response(document);

    await expect(assertSecurity(response, { nonce: false })).rejects.toThrow("Expected no document nonce");
  });

  it("reports a missing document nonce", async () => {
    await expect(assertSecurity(new Response("<title>Static</title>"), {
      nonce: true,
    })).rejects.toThrow("Expected a document nonce");
  });

  it("checks headers without reading a document nonce", async () => {
    const response = new Response("<title>Static</title>", {
      headers: { "content-security-policy": "default-src 'self'" },
    });

    await expect(assertSecurity(response, {
      csp: "default-src 'self'",
    })).resolves.toBeUndefined();
  });
});
