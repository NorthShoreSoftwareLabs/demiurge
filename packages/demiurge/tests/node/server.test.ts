import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { assertAdapterCapabilities } from "demiurge";
import { createNodeServer, nodeAdapter } from "demiurge/node";

describe("Node adapter", () => {
  it("serves static files before the route handler", async () => {
    const root = mkdtempSync(join(tmpdir(), "demiurge-node-server-"));
    writeFileSync(join(root, "app.js"), "console.log('ok');");
    const server = createNodeServer({
      handler: async () => new Response("route"),
      static: { root },
    });

    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const response = await fetch(`http://127.0.0.1:${port}/app.js`);

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("console.log('ok');");
    } finally {
      server.close();
      await once(server, "close").catch(() => undefined);
      await rm(root, { force: true, recursive: true });
    }
  });

  it("falls through to the Web Request handler and exposes capabilities", async () => {
    const server = createNodeServer({
      handler: async (request) =>
        new Response(
          JSON.stringify({ pathname: new URL(request.url).pathname }),
          { headers: { "content-type": "application/json" } },
        ),
    });

    assertAdapterCapabilities(nodeAdapter, ["streaming", "nonceInjection"]);

    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);

      await expect(response.json()).resolves.toEqual({ pathname: "/api/health" });
    } finally {
      server.close();
      await once(server, "close").catch(() => undefined);
    }
  });

  it("returns a generic 500 when the handler throws", async () => {
    const server = createNodeServer({
      handler: async () => {
        throw new Error("secret stack detail");
      },
    });

    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const response = await fetch(`http://127.0.0.1:${port}/failure`);

      expect(response.status).toBe(500);
      await expect(response.text()).resolves.toBe("Internal Server Error");
    } finally {
      server.close();
      await once(server, "close").catch(() => undefined);
    }
  });
});
