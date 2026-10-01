import { describe, expect, it } from "vitest";
import { createApplicationTest } from "@demiurgejs/core/testing";

const routes = {
  "./routes/@policy.ts": () => import("../src/routes/@policy"),
  "./routes/api/health.ts": () => import("../src/routes/api/health"),
};

describe("generated API application", () => {
  it("tests the health route through the public boundary", async () => {
    const response = await createApplicationTest({ routes }).request("/api/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
