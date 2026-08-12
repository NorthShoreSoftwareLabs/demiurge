import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStaticFileHandler } from "@demiurge/core/node";

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
  writeFileSync(join(root, "index.html"), "<html></html>");
  writeFileSync(
    join(root, "demiurge-manifest.json"),
    JSON.stringify({ clientEntry: "/assets/app-a1b2c3d4.js", styles: [] }),
  );
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "index.html"), "<html>docs</html>");
  writeFileSync(join(outside, "secret.txt"), "do not serve me");
  mkdirSync(join(outside, "private"));
  writeFileSync(join(outside, "private", "nested.txt"), "also secret");
  symlinkSync(join(outside, "secret.txt"), join(root, "file-link.txt"), "file");
  symlinkSync(join(outside, "private"), join(root, "directory-link"), "dir");
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

  it("sends validators and answers matching conditional requests with 304", async () => {
    const handle = createStaticFileHandler({ root });
    const initial = await handle(request("/robots.txt"));
    const etag = initial?.headers.get("etag");
    const lastModified = initial?.headers.get("last-modified");

    expect(etag).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);
    expect(lastModified).not.toBeNull();

    const byEtag = await handle(request("/robots.txt", {
      headers: { "if-none-match": `"other", ${etag}` },
    }));
    const byDate = await handle(request("/robots.txt", {
      headers: { "if-modified-since": lastModified! },
    }));

    for (const response of [byEtag, byDate]) {
      expect(response?.status).toBe(304);
      expect(response?.body).toBeNull();
      expect(response?.headers.get("content-length")).toBeNull();
      expect(response?.headers.get("etag")).toBe(etag);
      expect(response?.headers.get("last-modified")).toBe(lastModified);
    }
  });

  it("gives If-None-Match precedence over If-Modified-Since", async () => {
    const handle = createStaticFileHandler({ root });
    const response = await handle(request("/robots.txt", {
      headers: {
        "if-modified-since": "Sun, 06 Nov 2094 08:49:37 GMT",
        "if-none-match": '"not-the-current-validator"',
      },
    }));

    expect(response?.status).toBe(200);
    await expect(response?.text()).resolves.toBe("User-agent: *");
  });

  it("serves explicit, open-ended, and suffix byte ranges", async () => {
    const handle = createStaticFileHandler({ root });
    const cases = [
      ["bytes=0-3", "User", "bytes 0-3/13"],
      ["bytes=5-", "agent: *", "bytes 5-12/13"],
      ["bytes=-3", ": *", "bytes 10-12/13"],
    ] as const;

    for (const [range, body, contentRange] of cases) {
      const response = await handle(request("/robots.txt", {
        headers: { range },
      }));

      expect(response?.status).toBe(206);
      expect(response?.headers.get("accept-ranges")).toBe("bytes");
      expect(response?.headers.get("content-range")).toBe(contentRange);
      expect(response?.headers.get("content-length")).toBe(String(body.length));
      await expect(response?.text()).resolves.toBe(body);
    }
  });

  it("answers valid but unsatisfiable ranges with 416", async () => {
    const handle = createStaticFileHandler({ root });

    for (const range of ["bytes=13-20", "bytes=14-"]) {
      const response = await handle(request("/robots.txt", {
        headers: { range },
      }));

      expect(response?.status).toBe(416);
      expect(response?.body).toBeNull();
      expect(response?.headers.get("content-range")).toBe("bytes */13");
      expect(response?.headers.get("content-length")).toBeNull();
    }
  });

  it("ignores unsupported, malformed, and multiple ranges", async () => {
    const handle = createStaticFileHandler({ root });

    for (const range of ["items=0-1", "bytes=5-4", "bytes=0-1,4-5", "bytes=-0"]) {
      const response = await handle(request("/robots.txt", {
        headers: { range },
      }));

      expect(response?.status).toBe(200);
      expect(response?.headers.get("content-range")).toBeNull();
      await expect(response?.text()).resolves.toBe("User-agent: *");
    }
  });

  it("honors If-Range dates and ignores ranges for stale dates or weak tags", async () => {
    const handle = createStaticFileHandler({ root });
    const initial = await handle(request("/robots.txt"));
    const lastModified = initial?.headers.get("last-modified");
    const etag = initial?.headers.get("etag");
    await initial?.body?.cancel();

    const matchingDate = await handle(request("/robots.txt", {
      headers: { "if-range": lastModified!, range: "bytes=0-3" },
    }));
    const staleDate = await handle(request("/robots.txt", {
      headers: {
        "if-range": "Thu, 01 Jan 1970 00:00:00 GMT",
        range: "bytes=0-3",
      },
    }));
    const weakTag = await handle(request("/robots.txt", {
      headers: { "if-range": etag!, range: "bytes=0-3" },
    }));

    expect(matchingDate?.status).toBe(206);
    await expect(matchingDate?.text()).resolves.toBe("User");
    for (const response of [staleDate, weakTag]) {
      expect(response?.status).toBe(200);
      await expect(response?.text()).resolves.toBe("User-agent: *");
    }
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

  it("answers a ranged HEAD with partial response headers and no body", async () => {
    const handle = createStaticFileHandler({ root });
    const response = await handle(request("/robots.txt", {
      headers: { range: "bytes=0-3" },
      method: "HEAD",
    }));

    expect(response?.status).toBe(206);
    expect(response?.body).toBeNull();
    expect(response?.headers.get("content-range")).toBe("bytes 0-3/13");
    expect(response?.headers.get("content-length")).toBe("4");
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

  it("does not serve a file symlink that escapes the static root", async () => {
    const handle = createStaticFileHandler({ root });

    await expect(handle(request("/file-link.txt"))).resolves.toBeNull();
  });

  it("does not serve through a symlinked directory that escapes the root", async () => {
    const handle = createStaticFileHandler({ root });

    await expect(
      handle(request("/directory-link/nested.txt")),
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

  it("sends nosniff and same-origin resource policy headers on every response", async () => {
    const handle = createStaticFileHandler({ root });
    const response = await handle(request("/robots.txt"));

    expect(response?.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response?.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
  });

  // The SPA shell and the server's own build manifest must be reached only
  // through the route pipeline (or, for the manifest, not publicly at all) —
  // that is where `@policy.ts` applies CSP and the other headers a static
  // response never gets. See node/index.ts's static-before-route precedence.
  it("does not serve the SPA shell or the build manifest by default", async () => {
    const handle = createStaticFileHandler({ root });

    await expect(handle(request("/index.html"))).resolves.toBeNull();
    await expect(
      handle(request("/demiurge-manifest.json")),
    ).resolves.toBeNull();
  });

  // Only the build's own two files at the root are the framework's to hide.
  // A nested index.html is a page the app chose to ship.
  it("still serves an app-owned index.html below the root", async () => {
    const handle = createStaticFileHandler({ root });
    const response = await handle(request("/docs/index.html"));

    expect(response?.status).toBe(200);
    await expect(response?.text()).resolves.toBe("<html>docs</html>");
  });

  it("passes the root-relative path to a custom exclude predicate", async () => {
    const seen: string[] = [];
    const handle = createStaticFileHandler({
      exclude: (path) => {
        seen.push(path);
        return path === "docs/index.html";
      },
      root,
    });

    await expect(handle(request("/docs/index.html"))).resolves.toBeNull();
    expect(seen).toContain("docs/index.html");
    expect((await handle(request("/index.html")))?.status).toBe(200);
  });
});
