import { describe, expect, it } from "vitest";
import { createApplicationTest } from "@demiurgejs/core/testing";

const routes = {
  "./routes/@layout.tsx": () => import("../src/routes/@layout"),
  "./routes/@middleware.ts": () => import("../src/routes/@middleware"),
  "./routes/@not-found.tsx": () => import("../src/routes/@not-found"),
  "./routes/@policy.ts": () => import("../src/routes/@policy"),
  "./routes/account/@policy.ts": () => import("../src/routes/account/@policy"),
  "./routes/account/index.ts": () => import("../src/routes/account/index"),
  "./routes/index.tsx": () => import("../src/routes/index"),
  "./routes/messages.ts": () => import("../src/routes/messages"),
};
const application = createApplicationTest({ routes });

describe("generated application", () => {
  it("renders the page through the public test boundary", async () => {
    const response = await application.request("/");
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("Demiurge");
  });

  it("validates and runs a mutation", async () => {
    const form = new FormData();
    form.set("message", "  hello  ");
    const response = await application.request(new Request(
      "https://demiurge.test/messages",
      { body: form, method: "POST" },
    ));
    await expect(response.json()).resolves.toEqual({ message: "hello" });
  });

  it("enforces authorization before a protected route", async () => {
    const denied = await application.request("/account");
    const allowed = await application.request(new Request(
      "https://demiurge.test/account",
      { headers: { "x-account-id": "account-1" } },
    ));
    expect(denied.status).toBe(401);
    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toEqual({ accountId: "account-1" });
  });
});
