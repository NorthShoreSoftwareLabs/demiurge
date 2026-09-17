import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  createVercelFunction,
  type VercelBuildContext,
} from "../../src/vercel";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve) => server.close(() => resolve()))
  ));
});

describe("Vercel Node request bridge", () => {
  it("preserves a trusted scheme and client address through the request pipeline", async () => {
    const origin = await start(createVercelFunction({
      allowedHosts: ["127.0.0.1"],
      createHandler: () => async (request) => Response.json({
        address: request.headers.get("x-vercel-forwarded-for"),
        url: request.url,
      }),
      manifest: { clientEntry: "/assets/client.js", styles: [] },
    }));

    const response = await fetch(`${origin}/contact?source=page`, {
      headers: {
        "x-forwarded-proto": "https",
        "x-vercel-forwarded-for": "203.0.113.9",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      address: "203.0.113.9",
      url: expect.stringMatching(/^https:\/\/127\.0\.0\.1:\d+\/contact\?source=page$/),
    }));
  });

  it("rejects an untrusted host and a malformed Vercel address", async () => {
    const untrustedOrigin = await start(createVercelFunction({
      allowedHosts: ["example.test"],
      createHandler: () => async () => new Response("ok"),
      manifest: { clientEntry: "/assets/client.js", styles: [] },
    }));

    const untrusted = await fetch(`${untrustedOrigin}/`);
    expect(untrusted.status).toBe(421);

    const origin = await start(createVercelFunction({
      allowedHosts: ["127.0.0.1"],
      createHandler: () => async () => new Response("ok"),
      manifest: { clientEntry: "/assets/client.js", styles: [] },
    }));

    const malformed = await fetch(`${origin}/`, {
      headers: { "x-vercel-forwarded-for": "203.0.113.1, 192.0.2.1" },
    });
    expect(malformed.status).toBe(500);
  });

  it("reports an unsupported protocol without exposing the failure", async () => {
    const errors: unknown[] = [];
    const origin = await start(createVercelFunction({
      allowedHosts: ["127.0.0.1"],
      createHandler: () => async () => new Response("ok"),
      manifest: { clientEntry: "/assets/client.js", styles: [] },
      onError(error) {
        errors.push(error);
      },
    }));

    const response = await fetch(`${origin}/`, {
      headers: { "x-forwarded-proto": "ftp" },
    });
    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toBe("Internal Server Error");
    expect(errors).toHaveLength(1);
  });

  it("uses Vercel host environment values and refuses unavailable shared stores", async () => {
    let context: VercelBuildContext | undefined;
    createVercelFunction({
      createHandler(received) {
        context = received;
        return async () => new Response("ok");
      },
      env: {
        ALLOWED_HOSTS: " 127.0.0.1 ",
        VERCEL_PROJECT_PRODUCTION_URL: "production.example.test",
        VERCEL_URL: "deployment.example.test",
      },
      manifest: { clientEntry: "/assets/client.js", styles: [] },
    });

    const buildContext = context;
    if (buildContext === undefined) {
      throw new Error("The function did not create a handler.");
    }
    expect(() => buildContext.page.cacheStore.store.get({} as never))
      .toThrow(/no shared cache store/);
    const rateLimitStore = buildContext.page.rateLimitStore as {
      increment: (...arguments_: never[]) => unknown;
    };
    expect(() => rateLimitStore.increment())
      .toThrow(/no shared rate limit store/);
  });
});

async function start(listener: ReturnType<typeof createVercelFunction>) {
  const server = createServer((request, response) => {
    void listener(request, response);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server has no port.");
  return `http://127.0.0.1:${address.port}`;
}
