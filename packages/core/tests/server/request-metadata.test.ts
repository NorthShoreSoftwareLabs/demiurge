import { describe, expect, it } from "vitest";
import {
  copyRequestConnectionMetadata,
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
});
