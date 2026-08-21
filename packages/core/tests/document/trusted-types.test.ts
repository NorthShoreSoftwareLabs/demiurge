import { describe, expect, it, vi } from "vitest";
import {
  createFrameworkScriptUrl,
  FRAMEWORK_TRUSTED_TYPES_POLICY,
} from "@demiurgejs/core";

function viewWith(trustedTypes: unknown) {
  return { trustedTypes } as unknown as Window & typeof globalThis;
}

describe("createFrameworkScriptUrl", () => {
  it("returns the raw string when there is no window", () => {
    expect(createFrameworkScriptUrl(null, "/app.js")).toBe("/app.js");
    expect(createFrameworkScriptUrl(undefined, "https://example.test/app.js"))
      .toBe("https://example.test/app.js");
  });

  it("returns the raw string when the browser has no Trusted Types API", () => {
    expect(createFrameworkScriptUrl(viewWith(undefined), "/app.js"))
      .toBe("/app.js");
  });

  it("returns the raw string when createPolicy is not a function", () => {
    expect(createFrameworkScriptUrl(viewWith({}), "/app.js")).toBe("/app.js");
  });

  it("wraps a script URL with the framework demiurge policy", () => {
    const createScriptURL = vi.fn((url: string) => `trusted:${url}`);
    const createPolicy = vi.fn(() => ({ createScriptURL }));
    const view = viewWith({ createPolicy });

    expect(createFrameworkScriptUrl(view, "/app.js")).toBe("trusted:/app.js");
    expect(createPolicy).toHaveBeenCalledWith(FRAMEWORK_TRUSTED_TYPES_POLICY, {
      createScriptURL: expect.any(Function),
    });
    expect(createScriptURL).toHaveBeenCalledWith("/app.js");
  });

  it("creates the framework policy once per window", () => {
    const createPolicy = vi.fn(() => ({
      createScriptURL: (url: string) => url,
    }));
    const view = viewWith({ createPolicy });

    createFrameworkScriptUrl(view, "/a.js");
    createFrameworkScriptUrl(view, "/b.js");

    expect(createPolicy).toHaveBeenCalledTimes(1);
  });

  it("routes the script URL through the framework createScriptURL rule", () => {
    const view = viewWith({
      createPolicy: (
        _name: string,
        options: { createScriptURL: (value: string) => string },
      ) => ({
        createScriptURL: (value: string) =>
          `wrapped:${options.createScriptURL(value)}`,
      }),
    });

    expect(createFrameworkScriptUrl(view, "/app.js")).toBe("wrapped:/app.js");
  });

  it("falls back to the raw string when policy creation fails", () => {
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = viewWith({
      createPolicy: () => {
        throw new TypeError("refused");
      },
    });

    expect(createFrameworkScriptUrl(view, "/app.js")).toBe("/app.js");
    expect(report).toHaveBeenCalled();

    report.mockRestore();
  });
});
