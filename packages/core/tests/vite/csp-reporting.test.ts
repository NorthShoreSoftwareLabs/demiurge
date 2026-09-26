import { describe, expect, it, vi } from "vitest";
import {
  CSP_REPORT_PATH,
  createDevCspReportCollector,
} from "../../src/vite/csp-reporting";

function report(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    "csp-report": {
      "blocked-uri": "https://cdn.example.com/assets/app.js?token=secret#part",
      "column-number": 9,
      disposition: "enforce",
      "document-uri": "https://app.example.com/account?secret=yes#profile",
      "effective-directive": "script-src-elem",
      "line-number": 4,
      referrer: "https://private.example.com/previous?secret=yes",
      "script-sample": "complete private script contents",
      "source-file": "https://app.example.com/assets/page.js?secret=yes#source",
      ...overrides,
    },
  });
}

function request(body = report(), options: { headers?: HeadersInit; method?: string } = {}) {
  return new Request(`https://app.example.com${CSP_REPORT_PATH}`, {
    body: options.method === "GET" ? undefined : body,
    headers: {
      "content-type": "application/csp-report",
      ...options.headers,
    },
    method: options.method ?? "POST",
  });
}

describe("development CSP report collector", () => {
  it("ignores other paths and accepts only POST requests", async () => {
    const collector = createDevCspReportCollector({ log: vi.fn() });
    const ignored = await collector.handle(new Request("https://app.example.com/other"));
    const rejected = await collector.handle(request("", { method: "GET" }));

    expect(ignored).toBeNull();
    expect(rejected?.status).toBe(405);
    expect(rejected?.headers.get("allow")).toBe("POST");
  });

  it("returns 204 and logs only sanitized report fields", async () => {
    const log = vi.fn();
    const collector = createDevCspReportCollector({ log });
    const response = await collector.handle(request(report({
      "effective-directive": "script-src-elem\u0000",
    })));

    expect(response?.status).toBe(204);
    expect(log).toHaveBeenCalledOnce();
    const message = String(log.mock.calls[0]![0]);
    expect(message).toContain("directive=script-src-elem");
    expect(message).toContain("blocked=https://cdn.example.com");
    expect(message).toContain("document=/account");
    expect(message).toContain("source=/assets/page.js:4:9");
    expect(message).toContain("disposition=enforce");
    expect(message).not.toMatch(/token|secret|profile|private|script contents|referrer/i);
    expect([...message].every((character) => character.charCodeAt(0) > 31)).toBe(true);
  });

  it("rejects malformed JSON and invalid report shapes", async () => {
    const log = vi.fn();
    const collector = createDevCspReportCollector({ log });
    const malformed = await collector.handle(request("{"));
    const invalid = await collector.handle(request(JSON.stringify({
      "csp-report": { "blocked-uri": "https://cdn.example.com" },
    })));

    expect(malformed?.status).toBe(400);
    expect(invalid?.status).toBe(400);
    expect(log).not.toHaveBeenCalled();
  });

  it("rejects declared and streamed bodies above the limit", async () => {
    const collector = createDevCspReportCollector({
      log: vi.fn(),
      maxBodySize: "8b",
    });
    const declared = await collector.handle(request("{}", {
      headers: { "content-length": "9" },
    }));
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("{"));
        controller.enqueue(encoder.encode("\"long\":true}"));
        controller.close();
      },
    });
    const streamed = await collector.handle(new Request(
      `https://app.example.com${CSP_REPORT_PATH}`,
      {
        body,
        duplex: "half",
        headers: { "content-type": "application/csp-report" },
        method: "POST",
      } as RequestInit,
    ));

    expect(declared?.status).toBe(413);
    expect(streamed?.status).toBe(413);
  });

  it("deduplicates reports until expiry", async () => {
    let timestamp = 1_000;
    const log = vi.fn();
    const collector = createDevCspReportCollector({
      deduplicationTtlMs: 100,
      log,
      now: () => timestamp,
    });

    await collector.handle(request());
    await collector.handle(request());
    timestamp += 100;
    await collector.handle(request());

    expect(log).toHaveBeenCalledTimes(2);
  });

  it("bounds the deduplication cache and evicts its oldest report", async () => {
    const log = vi.fn();
    const collector = createDevCspReportCollector({
      deduplicationCapacity: 2,
      log,
    });

    await collector.handle(request(report({ "blocked-uri": "https://one.example.com/a" })));
    await collector.handle(request(report({ "blocked-uri": "https://two.example.com/a" })));
    await collector.handle(request(report({ "blocked-uri": "https://three.example.com/a" })));
    await collector.handle(request(report({ "blocked-uri": "https://one.example.com/a" })));

    expect(log).toHaveBeenCalledTimes(4);
  });

  it("rate-limits unique logs and resumes in a new window", async () => {
    let timestamp = 1_000;
    const log = vi.fn();
    const collector = createDevCspReportCollector({
      log,
      now: () => timestamp,
      rateLimitMax: 2,
      rateLimitWindowMs: 100,
    });

    for (const host of ["one", "two", "three"]) {
      const response = await collector.handle(request(report({
        "blocked-uri": `https://${host}.example.com/a`,
      })));
      expect(response?.status).toBe(204);
    }

    expect(log).toHaveBeenCalledTimes(2);
    timestamp += 100;
    await collector.handle(request(report({
      "blocked-uri": "https://four.example.com/a",
    })));
    expect(log).toHaveBeenCalledTimes(3);
  });
});
