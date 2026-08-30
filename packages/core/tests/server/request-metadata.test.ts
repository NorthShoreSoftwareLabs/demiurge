import { describe, expect, it } from "vitest";
import {
  copyRequestConnectionMetadata,
  getRequestClientAddress,
  getRequestConnectionMetadata,
  setRequestConnectionMetadata,
} from "../../src/server/request-metadata";

describe("request connection metadata", () => {
  it("copies trusted connection identity when a request body is wrapped", () => {
    const source = new Request("https://example.test/");
    const wrapped = new Request(source);

    setRequestConnectionMetadata(source, { clientIp: "203.0.113.8" });
    copyRequestConnectionMetadata(source, wrapped);

    expect(getRequestConnectionMetadata(wrapped)).toEqual({
      clientIp: "203.0.113.8",
    });
  });

  it("does not invent connection identity for a plain Fetch request", () => {
    const source = new Request("https://example.test/");
    const wrapped = new Request(source);

    copyRequestConnectionMetadata(source, wrapped);

    expect(getRequestConnectionMetadata(wrapped)).toBeUndefined();
  });

  it("reports the resolved client address the adapter stored", () => {
    const request = new Request("https://example.test/");

    setRequestConnectionMetadata(request, { clientIp: "198.51.100.7" });

    expect(getRequestClientAddress(request)).toBe("198.51.100.7");
  });

  it("reports no client address for a plain Fetch request", () => {
    const request = new Request("https://example.test/");

    expect(getRequestClientAddress(request)).toBeUndefined();
  });
});
