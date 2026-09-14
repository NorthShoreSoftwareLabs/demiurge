import { describe, expect, it, vi } from "vitest";
import {
  createApplicationTest,
} from "../../src/testing";
import { text } from "../../src/route";

describe("createApplicationTest", () => {
  it("passes a pathname through the supplied production handler", async () => {
    const handler = vi.fn(async (request: Request) => new Response(request.url));
    const application = createApplicationTest(handler);

    const response = await application.request("/health?deep=true");

    await expect(response.text()).resolves.toBe("https://demiurge.test/health?deep=true");
    expect(handler).toHaveBeenCalledWith(expect.any(Request));
  });

  it("keeps a supplied request unchanged", async () => {
    const request = new Request("https://consumer.test/messages", { method: "POST" });
    const application = createApplicationTest(async (received) => new Response(received.method));

    const response = await application.request(request);

    await expect(response.text()).resolves.toBe("POST");
  });

  it("creates the production route pipeline from handler options", async () => {
    const middleware = vi.fn(async (_context, next) => await next());
    const application = createApplicationTest({
      routes: {
        "./routes/messages.ts": async () => ({
          GET: text("message"),
          policy: { access: { public: true } },
        }),
        "./routes/@middleware.ts": async () => ({ middleware }),
      },
    });

    const response = await application.request(new URL("/messages", "https://consumer.test"));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("message");
    expect(middleware).toHaveBeenCalledOnce();
  });
});
