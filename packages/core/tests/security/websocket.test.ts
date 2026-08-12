import { describe, expect, it } from "vitest";
import {
  checkWebSocketOrigin,
  enforceWebSocketOrigin,
} from "@demiurgejs/core";

describe("WebSocket origin checks", () => {
  it("allows same-origin browser upgrade requests", () => {
    const request = new Request("https://app.example.com/socket", {
      headers: {
        origin: "https://app.example.com",
      },
    });

    expect(checkWebSocketOrigin({ origins: "same-origin" }, request)).toEqual({
      allowed: true,
      expected: "same-origin",
      origin: "https://app.example.com",
      reason: undefined,
    });
    expect(enforceWebSocketOrigin({ origins: "same-origin" }, request)).toBeNull();
  });

  it("allows explicitly configured origins", () => {
    const request = new Request("https://api.example.com/socket", {
      headers: {
        origin: "https://app.example.com",
      },
    });

    expect(
      checkWebSocketOrigin(
        {
          origins: ["https://app.example.com"],
        },
        request,
      ),
    ).toEqual({
      allowed: true,
      expected: ["https://app.example.com"],
      origin: "https://app.example.com",
      reason: undefined,
    });
  });

  it("rejects URL-like values that are not serialized origins", () => {
    for (const origin of [
      "https://app.example.com/forged-path",
      "https://user@app.example.com",
      "https://app.example.com?forged=true",
      "wss://app.example.com",
    ]) {
      const request = new Request("https://api.example.com/socket", {
        headers: { origin },
      });

      expect(
        checkWebSocketOrigin(
          { origins: ["https://app.example.com"] },
          request,
        ),
      ).toMatchObject({
        allowed: false,
        origin,
        reason: "invalid-origin",
      });
    }
  });

  it("rejects missing, malformed, and unlisted origins", async () => {
    const missing = new Request("https://api.example.com/socket");
    const malformed = new Request("https://api.example.com/socket", {
      headers: {
        origin: "not a url",
      },
    });
    const unlisted = new Request("https://api.example.com/socket", {
      headers: {
        origin: "https://evil.example.com",
      },
    });

    expect(checkWebSocketOrigin({ origins: "same-origin" }, missing)).toEqual({
      allowed: false,
      expected: "same-origin",
      origin: null,
      reason: "missing-origin",
    });
    expect(checkWebSocketOrigin({ origins: "same-origin" }, malformed)).toEqual({
      allowed: false,
      expected: "same-origin",
      origin: "not a url",
      reason: "invalid-origin",
    });
    expect(
      checkWebSocketOrigin(
        { origins: ["https://app.example.com"] },
        unlisted,
      ),
    ).toEqual({
      allowed: false,
      expected: ["https://app.example.com"],
      origin: "https://evil.example.com",
      reason: "origin-not-allowed",
    });

    const response = enforceWebSocketOrigin({ origins: "same-origin" }, unlisted);

    expect(response?.status).toBe(403);
    expect(await response?.text()).toBe("WebSocket origin not allowed.");
  });

  it("can allow missing origins for trusted non-browser clients", () => {
    const request = new Request("https://api.example.com/socket");

    expect(
      checkWebSocketOrigin(
        {
          allowMissingOrigin: true,
          origins: "same-origin",
        },
        request,
      ),
    ).toEqual({
      allowed: true,
      expected: "same-origin",
      origin: null,
      reason: undefined,
    });
  });
});
