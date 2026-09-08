import { describe, expect, it } from "vitest";

describe("server-only package export", () => {
  it("throws when the browser condition module evaluates", async () => {
    await expect(import("../../src/server-only/browser")).rejects.toThrow(
      /server-only/,
    );
  });

  it("does nothing when the default condition module evaluates", async () => {
    await expect(import("../../src/server-only/index")).resolves.toBeDefined();
  });
});
