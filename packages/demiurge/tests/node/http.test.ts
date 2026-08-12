import { Readable, Writable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { createMemoryRateLimitStore, enforceRateLimit } from "@demiurge/core";
import {
  UntrustedHostError,
  UnsupportedMethodError,
  toHeaders,
  toWebRequest,
  writeWebResponse,
} from "@demiurge/core/node";

function incoming(init: Partial<IncomingMessage> = {}) {
  return Object.assign(Readable.from([Buffer.from("hello")]), {
    headers: {},
    method: "GET",
    socket: { remoteAddress: "198.51.100.20" },
    url: "/health?ready=true",
    ...init,
  }) as IncomingMessage;
}

describe("Node HTTP bridge", () => {
  it("converts incoming headers and request metadata", () => {
    const request = toWebRequest(
      incoming({
        headers: {
          host: "example.test",
          "x-forwarded-for": "203.0.113.8",
          "x-forwarded-host": "public.example.test",
          "x-forwarded-proto": "https",
          "x-request-id": ["one", "two"],
        },
      }),
      { allowedHosts: ["public.example.test"], trustProxy: { hops: 1 } },
    );

    expect(request.url).toBe("https://public.example.test/health?ready=true");
    expect(request.headers.get("x-request-id")).toBe("one, two");
    expect(request.method).toBe("GET");
  });

  it("uses HTTP request defaults when Node omits optional metadata", () => {
    const request = toWebRequest(
      incoming({
        headers: { host: "localhost" },
        method: undefined,
        url: undefined,
      }),
      { allowedHosts: ["localhost"] },
    );

    expect(request.method).toBe("GET");
    expect(request.url).toBe("http://localhost/");
  });

  it("preserves request bodies for non-GET methods", async () => {
    const request = toWebRequest(
      incoming({
        headers: { host: "example.test" },
        method: "POST",
      }),
      { allowedHosts: ["example.test"] },
    );

    await expect(request.text()).resolves.toBe("hello");
  });

  it("converts Node response metadata and repeated cookies", async () => {
    const headers = new Map<string, string | string[]>();
    let body = "";
    const response = new Writable({
      write(chunk, _encoding, callback) {
        body += String(chunk);
        callback();
      },
    });
    const nodeResponse = Object.assign(response, {
      setHeader(name: string, value: string | string[]) {
        headers.set(name, value);
      },
      statusCode: 0,
      statusMessage: "",
    }) as unknown as ServerResponse;
    const webResponse = new Response("hello", { status: 201 });
    webResponse.headers.append("set-cookie", "a=1");
    webResponse.headers.append("set-cookie", "b=2");
    webResponse.headers.set("x-test", "ok");

    await writeWebResponse(nodeResponse, webResponse);

    expect(nodeResponse.statusCode).toBe(201);
    expect(headers.get("set-cookie")).toEqual(["a=1", "b=2"]);
    expect(headers.get("x-test")).toBe("ok");
    expect(body).toBe("hello");
  });

  it.each(["TRACE", "TRACK", "CONNECT", "trace"])(
    "rejects the forbidden %s method before constructing a Request",
    (method) => {
      expect(() =>
        toWebRequest(incoming({ method }), { allowedHosts: ["localhost"] }),
      ).toThrow(
        UnsupportedMethodError,
      );
    },
  );

  it("ignores spoofed forwarding headers when no proxy is trusted", () => {
    const request = toWebRequest(
      incoming({
        headers: {
          host: "example.test",
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "https",
        },
      }),
      { allowedHosts: ["example.test"] },
    );

    expect(request.url).toBe("http://example.test/health?ready=true");
  });

  it("rejects direct and trusted-forwarded hosts outside the allowlist", () => {
    expect(() =>
      toWebRequest(
        incoming({ headers: { host: "evil.example" } }),
        { allowedHosts: ["example.test"] },
      ),
    ).toThrow(UntrustedHostError);
    expect(() =>
      toWebRequest(
        incoming({
          headers: {
            host: "internal.example",
            "x-forwarded-for": "203.0.113.8",
            "x-forwarded-host": "evil.example",
          },
        }),
        { allowedHosts: ["example.test"], trustProxy: { hops: 1 } },
      ),
    ).toThrow(UntrustedHostError);
  });

  it("trusts forwarded values only when the peer matches a configured range", () => {
    const trusted = toWebRequest(
      incoming({
        headers: {
          host: "internal.example",
          "x-forwarded-for": "203.0.113.8",
          "x-forwarded-host": "example.test",
          "x-forwarded-proto": "https",
        },
        socket: { remoteAddress: "10.2.3.4" } as never,
      }),
      {
        allowedHosts: ["example.test"],
        trustProxy: { ranges: ["10.0.0.0/8"] },
      },
    );

    expect(trusted.url).toBe("https://example.test/health?ready=true");
    expect(() =>
      toWebRequest(
        incoming({
          headers: {
            host: "internal.example",
            "x-forwarded-for": "203.0.113.8",
            "x-forwarded-host": "example.test",
          },
          socket: { remoteAddress: "192.0.2.5" } as never,
        }),
        {
          allowedHosts: ["example.test"],
          trustProxy: { ranges: ["10.0.0.0/8"] },
        },
      ),
    ).toThrow(UntrustedHostError);
  });

  it("supports exact, mapped IPv4, and IPv6 trusted proxy ranges", () => {
    const forwardedRequest = (remoteAddress: string, ranges: readonly string[]) =>
      toWebRequest(
        incoming({
          headers: {
            host: "internal.example",
            "x-forwarded-for": "203.0.113.8",
            "x-forwarded-host": "example.test",
            "x-forwarded-proto": "https",
          },
          socket: { remoteAddress } as never,
        }),
        { allowedHosts: ["example.test"], trustProxy: { ranges } },
      );

    expect(forwardedRequest("10.0.0.1", ["10.0.0.1"]).url).toMatch(
      /^https:\/\/example\.test/,
    );
    expect(forwardedRequest("::ffff:10.2.3.4", ["10.0.0.0/8"]).url).toMatch(
      /^https:\/\/example\.test/,
    );
    expect(forwardedRequest("2001:db8::1", ["2001:db8::/32"]).url).toMatch(
      /^https:\/\/example\.test/,
    );
  });

  it("does not trust a proxy address from the wrong IP family", () => {
    const request = toWebRequest(
      incoming({
        headers: {
          host: "example.test",
          "x-forwarded-host": "forwarded.example.test",
          "x-forwarded-proto": "https",
        },
        socket: { remoteAddress: "192.0.2.5" } as never,
      }),
      {
        allowedHosts: ["example.test"],
        trustProxy: { ranges: ["2001:db8::/32"] },
      },
    );

    expect(request.url).toBe("http://example.test/health?ready=true");
  });

  it("selects forwarded header arrays from the trusted edge inward", () => {
    const request = toWebRequest(
      incoming({
        headers: {
          host: "internal.example",
          "x-forwarded-for": ["192.0.2.7", "203.0.113.8"],
          "x-forwarded-host": ["ignored.example", "example.test"],
          "x-forwarded-proto": ["http", "https"],
        },
      }),
      { allowedHosts: ["example.test"], trustProxy: { hops: 1 } },
    );

    expect(request.url).toBe("https://example.test/health?ready=true");
  });

  it("rejects unsupported trusted forwarding protocols", () => {
    expect(() =>
      toWebRequest(
        incoming({
          headers: {
            host: "internal.example",
            "x-forwarded-host": "example.test",
            "x-forwarded-proto": "ftp",
          },
        }),
        { allowedHosts: ["example.test"], trustProxy: { hops: 1 } },
      ),
    ).toThrow('Unsupported forwarded protocol "ftp"');
  });

  it("enforces explicit allowed-host ports while a host-only entry accepts any port", () => {
    const exact = toWebRequest(
      incoming({ headers: { host: "example.test:8443" } }),
      { allowedHosts: ["example.test:8443"] },
    );
    const hostOnly = toWebRequest(
      incoming({ headers: { host: "example.test:9443" } }),
      { allowedHosts: ["example.test"] },
    );

    expect(exact.url).toMatch(/^http:\/\/example\.test:8443/);
    expect(hostOnly.url).toMatch(/^http:\/\/example\.test:9443/);
    expect(() =>
      toWebRequest(
        incoming({ headers: { host: "example.test:9443" } }),
        { allowedHosts: ["example.test:8443"] },
      ),
    ).toThrow(UntrustedHostError);
  });

  it.each([
    " example.test",
    "user@example.test",
    "example.test/path",
    "example.test?query",
    "example.test#hash",
    "[invalid",
  ])("rejects malformed allowed host %s at configuration time", (host) => {
    expect(() =>
      toWebRequest(incoming({ headers: { host: "example.test" } }), {
        allowedHosts: [host],
      }),
    ).toThrow("allowed host");
  });

  it("rejects missing and malformed request authorities", () => {
    expect(() =>
      toWebRequest(incoming({ headers: {} }), {
        allowedHosts: ["example.test"],
      }),
    ).toThrow(UntrustedHostError);
    expect(() =>
      toWebRequest(incoming({ headers: { host: "user@example.test" } }), {
        allowedHosts: ["example.test"],
      }),
    ).toThrow(UntrustedHostError);
  });

  it("feeds only the resolved peer identity to IP rate limiting", () => {
    const store = createMemoryRateLimitStore();
    const policy = { key: "ip", limit: 1, window: "1m" } as const;
    const direct = (spoofedIp: string) =>
      toWebRequest(
        incoming({
          headers: {
            host: "example.test",
            "x-forwarded-for": spoofedIp,
          },
          socket: { remoteAddress: "198.51.100.20" } as never,
        }),
        { allowedHosts: ["example.test"] },
      );

    expect(enforceRateLimit(policy, direct("203.0.113.1"), store, 0)).toBe(null);
    expect(
      enforceRateLimit(policy, direct("203.0.113.2"), store, 0)?.status,
    ).toBe(429);
  });

  it("reads X-Forwarded-For right-to-left for a trusted hop count", () => {
    const store = createMemoryRateLimitStore();
    const policy = { key: "ip", limit: 1, window: "1m" } as const;
    const proxied = (spoofedLeftmost: string) =>
      toWebRequest(
        incoming({
          headers: {
            host: "example.test",
            "x-forwarded-for": `${spoofedLeftmost}, 203.0.113.9`,
          },
          socket: { remoteAddress: "10.0.0.2" } as never,
        }),
        {
          allowedHosts: ["example.test"],
          trustProxy: { hops: 1 },
        },
      );

    expect(enforceRateLimit(policy, proxied("192.0.2.1"), store, 0)).toBe(null);
    expect(
      enforceRateLimit(policy, proxied("192.0.2.2"), store, 0)?.status,
    ).toBe(429);
  });

  it("detects TLS directly and validates typed origin policy options", () => {
    const request = toWebRequest(
      incoming({
        headers: { host: "example.test" },
        socket: {
          encrypted: true,
          remoteAddress: "198.51.100.20",
        } as never,
      }),
      { allowedHosts: ["example.test"] },
    );

    expect(request.url).toBe("https://example.test/health?ready=true");
    expect(() =>
      toWebRequest(incoming(), { allowedHosts: [] }),
    ).toThrow("allowedHosts must contain at least one host");
    expect(() =>
      toWebRequest(incoming(), {
        allowedHosts: ["localhost"],
        trustProxy: { hops: -1 },
      }),
    ).toThrow("hop count must be a non-negative integer");
    expect(() =>
      toWebRequest(incoming(), {
        allowedHosts: ["localhost"],
        trustProxy: { ranges: ["10.0.0.0/99"] },
      }),
    ).toThrow('trustProxy range "10.0.0.0/99" is invalid');
  });

  it("supports empty responses and direct header conversion", async () => {
    const output: string[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        output.push(String(chunk));
        callback();
      },
    });
    const response = Object.assign(writable, {
      setHeader() {},
      statusCode: 0,
      statusMessage: "",
    }) as unknown as ServerResponse;

    await writeWebResponse(response, new Response(null, { status: 204 }));

    expect(response.statusCode).toBe(204);
    expect(output).toEqual([]);
    expect(toHeaders({ accept: "text/html" }).get("accept")).toBe("text/html");
  });
});
