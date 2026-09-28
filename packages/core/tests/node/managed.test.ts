import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createManagedNodeRequestListener } from "../../src/node/managed";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve) => server.close(() => resolve()))
  ));
});

describe("managed Node request listener", () => {
  it("uses the response directly when the host defines no optional hooks", async () => {
    const listener = createManagedNodeRequestListener({
      allowedHosts: ["127.0.0.1"],
      handler: async (request) => new Response(new URL(request.url).pathname),
    });
    const origin = await start(listener);

    const response = await fetch(`${origin}/managed`);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("/managed");
  });
});

async function start(
  listener: ReturnType<typeof createManagedNodeRequestListener>,
) {
  const server = createServer((request, response) => {
    void listener(request, response);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("The managed listener test server has no port.");
  }
  return `http://127.0.0.1:${address.port}`;
}
