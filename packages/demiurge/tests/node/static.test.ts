import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStaticFileHandler } from "demiurge/node";

let root = "";
let outside = "";

beforeAll(() => {
  outside = mkdtempSync(join(tmpdir(), "demiurge-static-"));
  root = join(outside, "client");
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(join(root, "assets", "app-a1b2c3d4.js"), "export default 1;\n");
  writeFileSync(join(root, "assets", "app-a1b2c3d4.css"), "body { color: red }");
  writeFileSync(join(root, "logo.svg"), "<svg></svg>");
  writeFileSync(join(root, "robots.txt"), "User-agent: *");
  writeFileSync(join(root, "data.bin"), "binary");
  writeFileSync(join(outside, "secret.txt"), "do not serve me");
});

afterAll(() => {
  rmSync(outside, { force: true, recursive: true });
});

function request(pathname: string, init?: RequestInit) {
  return new Request(`http://localhost${pathname}`, init);
}

describe("static file handler", () => {
  it("serves a file with its content type and body", async () => {
    const handle = createStaticFileHandler({ root });
    const response = await handle(request("/assets/app-a1b2c3d4.js"));

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(response?.headers.get("content-length")).toBe("18");
    await expect(response?.text()).resolves.toBe("export default 1;\n");
  });

  it("marks hashed file names as immutable and leaves others revalidating", async () => {
    const handle = createStaticFileHandler({ root });

    expect(
      (await handle(request("/assets/app-a1b2c3d4.css")))?.headers.get(
        "cache-control",
      ),
    ).toBe("public, max-age=31536000, immutable");
    expect(
      (await handle(request("/robots.txt")))?.headers.get("cache-control"),
    ).toBe("public, max-age=0, must-revalidate");
  });

  it("accepts a custom immutable predicate", async () => {
    const handle = createStaticFileHandler({
      immutable: (fileName) => fileName.endsWith(".txt"),
      root,
    });

    expect(
      (await handle(request("/robots.txt")))?.headers.get("cache-control"),
    ).toBe("public, max-age=31536000, immutable");
  });

  it("answers HEAD without a body but with the file length", async () => {
    const handle = createStaticFileHandler({ root });
    const response = await handle(
      request("/robots.txt", { method: "HEAD" }),
    );

    expect(response?.body).toBeNull();
    expect(response?.headers.get("content-length")).toBe("13");
  });

  it("resolves content types by extension and falls back to octet-stream", async () => {
    const handle = createStaticFileHandler({ root });

    expect(
      (await handle(request("/logo.svg")))?.headers.get("content-type"),
    ).toBe("image/svg+xml");
    expect(
      (await handle(request("/assets/app-a1b2c3d4.css")))?.headers.get(
        "content-type",
      ),
    ).toBe("text/css; charset=utf-8");
    expect(
      (await handle(request("/data.bin")))?.headers.get("content-type"),
    ).toBe("application/octet-stream");
  });

  it("declines methods that cannot read a file", async () => {
    const handle = createStaticFileHandler({ root });

    await expect(
      handle(request("/robots.txt", { method: "POST" })),
    ).resolves.toBeNull();
  });

  it("declines missing files and directories", async () => {
    const handle = createStaticFileHandler({ root });

    await expect(handle(request("/nope.js"))).resolves.toBeNull();
    await expect(handle(request("/assets/"))).resolves.toBeNull();
    await expect(handle(request("/assets"))).resolves.toBeNull();
  });

  // Plain dot segments never reach the handler, because URL parsing collapses
  // them before the handler sees a pathname. Encoded segments do reach it, so
  // they are what actually exercises the containment check.
  it("does not serve a file above the root when dot segments are collapsed", async () => {
    const handle = createStaticFileHandler({ root });

    await expect(handle(request("/../secret.txt"))).resolves.toBeNull();
    await expect(
      handle(request("/assets/../../secret.txt")),
    ).resolves.toBeNull();
  });

  it("refuses to escape the root through encoded traversal segments", async () => {
    const handle = createStaticFileHandler({ root });

    await expect(handle(request("/%2e%2e/secret.txt"))).resolves.toBeNull();
    await expect(
      handle(request("/assets/%2e%2e%2f%2e%2e%2fsecret.txt")),
    ).resolves.toBeNull();
  });

  it("refuses malformed and null-byte pathnames", async () => {
    const handle = createStaticFileHandler({ root });

    await expect(handle(request("/%ZZ"))).resolves.toBeNull();
    await expect(
      handle(request("/robots.txt%00.js")),
    ).resolves.toBeNull();
  });

  it("mounts the root under a configured prefix and strips it", async () => {
    const handle = createStaticFileHandler({ prefix: "/static", root });

    expect((await handle(request("/static/robots.txt")))?.status).toBe(200);
    expect(
      (await handle(request("/static/assets/app-a1b2c3d4.js")))?.status,
    ).toBe(200);
    await expect(handle(request("/robots.txt"))).resolves.toBeNull();
  });

  it("refuses to escape the root from under a prefix", async () => {
    const handle = createStaticFileHandler({ prefix: "/static", root });

    await expect(
      handle(request("/static/%2e%2e/%2e%2e/secret.txt")),
    ).resolves.toBeNull();
  });

  it("treats a root prefix as no prefix at all", async () => {
    const handle = createStaticFileHandler({ prefix: "/", root });

    expect((await handle(request("/robots.txt")))?.status).toBe(200);
  });
});
