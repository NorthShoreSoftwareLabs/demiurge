import { afterEach, describe, expect, it, vi } from "vitest";
import { defineAdapter, json } from "@demiurgejs/core";
import { validateRouteModules } from "../../src/security/verification";

describe("adapter request boundary diagnostics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("names an adapter that cannot enforce a request timeout", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = defineAdapter({ name: "edge" });

    validateRouteModules(
      { "./routes/api.ts": { GET: json({}) } },
      { adapter },
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("edge");
    expect(warn.mock.calls[0]?.[0]).toContain("requestTimeoutEnforcement");
  });

  it("stays silent for an adapter that enforces a request timeout", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = defineAdapter({
      name: "node",
      capabilities: { requestTimeoutEnforcement: true },
    });

    validateRouteModules(
      { "./routes/api.ts": { GET: json({}) } },
      { adapter },
    );

    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent when no adapter is given", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    validateRouteModules({ "./routes/api.ts": { GET: json({}) } });

    expect(warn).not.toHaveBeenCalled();
  });
});
