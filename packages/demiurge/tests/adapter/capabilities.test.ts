import { describe, expect, it } from "vitest";
import {
  assertAdapterCapabilities,
  checkAdapterCapabilities,
  defineAdapter,
} from "demiurge";

describe("adapter capability checks", () => {
  it("defaults unsupported adapter capabilities to false", () => {
    const adapter = defineAdapter({
      name: "static",
      capabilities: {
        staticOutput: true,
      },
    });

    expect(adapter.capabilities).toEqual({
      backgroundLifetime: false,
      crossOriginIsolationHeaders: false,
      nonceInjection: false,
      sharedCache: false,
      staticOutput: true,
      streaming: false,
      webSocket: false,
      webTransport: false,
    });
  });

  it("reports missing required capabilities without duplicating requirements", () => {
    const adapter = defineAdapter({
      name: "edge",
      capabilities: {
        nonceInjection: true,
        streaming: true,
      },
    });

    expect(
      checkAdapterCapabilities(adapter, [
        "streaming",
        "webSocket",
        "webSocket",
        "nonceInjection",
      ]),
    ).toEqual({
      adapter: "edge",
      missing: ["webSocket"],
      ok: false,
      required: ["streaming", "webSocket", "nonceInjection"],
    });
  });

  it("returns successful checks for supported capabilities", () => {
    const adapter = defineAdapter({
      name: "node",
      capabilities: {
        nonceInjection: true,
        streaming: true,
        webSocket: true,
      },
    });

    expect(
      assertAdapterCapabilities(adapter, [
        "streaming",
        "nonceInjection",
        "webSocket",
      ]),
    ).toEqual({
      adapter: "node",
      missing: [],
      ok: true,
      required: ["streaming", "nonceInjection", "webSocket"],
    });
  });

  it("throws clear errors for unsupported capabilities", () => {
    const adapter = defineAdapter({
      name: "static",
      capabilities: {
        staticOutput: true,
      },
    });

    expect(() =>
      assertAdapterCapabilities(adapter, [
        "streaming",
        "nonceInjection",
      ]),
    ).toThrow(
      'Adapter "static" does not support required capabilities: streaming, nonceInjection.',
    );
  });
});
