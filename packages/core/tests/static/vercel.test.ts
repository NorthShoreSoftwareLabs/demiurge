import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { StaticOutputManifest } from "../../src/static";
import {
  createVercelOutputConfig,
  generateVercelStaticOutput,
  vercelStatic,
  type VercelOutputConfig,
} from "../../src/static/vercel";

const manifest: StaticOutputManifest = {
  adapter: "static",
  entries: [
    {
      file: "404.html",
      headers: {
        "content-security-policy": "default-src 'none'",
        "content-type": "text/html; charset=utf-8",
      },
      pathname: "*",
      status: 404,
    },
    {
      file: "about/index.html",
      headers: {
        "content-security-policy": "default-src 'self'",
        "content-type": "text/html; charset=utf-8",
      },
      pathname: "/about",
      status: 200,
    },
    {
      file: "index.html",
      headers: {
        "content-security-policy": "default-src 'none'",
        "content-type": "text/html; charset=utf-8",
      },
      pathname: "/",
      status: 200,
    },
    {
      file: "robots.txt",
      headers: {
        "cache-control": "public, max-age=60",
        "content-type": "text/plain; charset=utf-8",
      },
      pathname: "/robots.txt",
      status: 200,
    },
  ],
  fileHeaderRules: [
    {
      headers: { "cache-control": "public, max-age=31536000, immutable" },
      pattern: "-[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9]+$",
    },
    {
      headers: { "cache-control": "public, max-age=0, must-revalidate" },
      pattern: ".*",
    },
  ],
  origin: "https://example.test",
  version: 1,
};

type RoutingResult = {
  headers: Record<string, string>;
  pathname: string;
  status: number;
};

function evaluateRouting(
  config: VercelOutputConfig,
  pathname: string,
  files = new Set([
    "/assets/app-12345678.js",
    "/assets/app-Abcd_123.css",
    "/assets/font-12345678.woff2",
    "/site.webmanifest",
  ]),
): RoutingResult {
  const headers: Record<string, string> = {};
  let status = 200;

  for (const route of config.routes) {
    if ("handle" in route) {
      if (route.handle === "filesystem" && files.has(pathname)) break;
      continue;
    }
    if (!new RegExp(route.src).test(pathname)) continue;

    for (const [name, value] of Object.entries(route.headers ?? {})) {
      headers[name.toLowerCase()] = value;
    }
    pathname = route.dest ?? pathname;
    status = route.status ?? status;
    if (!route.continue) {
      for (const transform of route.transforms ?? []) {
        delete headers[transform.target.key.toLowerCase()];
      }
      break;
    }
  }

  return { headers, pathname, status };
}

describe("Vercel static output", () => {
  it("maps route policy, ordered file rules, overrides, and the fallback", () => {
    const config = createVercelOutputConfig(
      manifest,
      vercelStatic({
        cache: [{
          source: "/videos/:path*",
          value: "public, max-age=604800",
        }],
      }),
    );

    expect(config).toMatchObject({
      overrides: {
        "404.html": { contentType: "text/html; charset=utf-8" },
        "about/index.html": {
          contentType: "text/html; charset=utf-8",
          path: "about",
        },
        "index.html": { contentType: "text/html; charset=utf-8" },
        "robots.txt": { contentType: "text/plain; charset=utf-8" },
      },
      version: 3,
    });
    expect(config.routes).toEqual([
      {
        continue: true,
        headers: { "access-control-allow-origin": "https://example.test" },
        src: "^/.*$",
      },
      { continue: true, dest: "/about", src: "^/about/index\\.html/?$" },
      { continue: true, dest: "/", src: "^/index\\.html/?$" },
      {
        continue: true,
        headers: { "cache-control": "public, max-age=0, must-revalidate" },
        src: "^/.*$",
      },
      {
        continue: true,
        headers: { "cache-control": "public, max-age=31536000, immutable" },
        src: "^/(?:.*/)?[^/]*-[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9]+$",
      },
      {
        continue: true,
        headers: { "content-security-policy": "default-src 'none'" },
        src: "^/404\\.html/?$",
      },
      {
        continue: true,
        headers: { "content-security-policy": "default-src 'self'" },
        src: "^/about/?$",
      },
      {
        continue: true,
        headers: { "content-security-policy": "default-src 'none'" },
        src: "^/$",
      },
      {
        continue: true,
        headers: { "cache-control": "public, max-age=60" },
        src: "^/robots\\.txt/?$",
      },
      {
        continue: true,
        headers: { "cache-control": "public, max-age=604800" },
        src: "^/videos(?:/((?:[^/]+?)(?:/(?:[^/]+?))*))?$",
      },
      { dest: "/404.html", src: "^/404\\.html/?$", status: 404 },
      { dest: "/about", src: "^/about/?$" },
      { dest: "/index.html", src: "^/$" },
      { dest: "/robots.txt", src: "^/robots\\.txt/?$" },
      { handle: "filesystem" },
      {
        continue: true,
        headers: { "cache-control": "public, max-age=0, must-revalidate" },
        src: "^/.*$",
      },
      {
        continue: true,
        headers: { "cache-control": "public, max-age=604800" },
        src: "^/videos(?:/((?:[^/]+?)(?:/(?:[^/]+?))*))?$",
      },
      {
        dest: "/404.html",
        headers: { "content-security-policy": "default-src 'none'" },
        src: "^/.*$",
        status: 404,
      },
    ]);
  });

  it("keeps the fallback headers after file lookup", () => {
    const config = createVercelOutputConfig(manifest, vercelStatic());
    const filesystemIndex = config.routes.findIndex((route) =>
      "handle" in route && route.handle === "filesystem"
    );
    const fallbackRoute = config.routes.at(-1);

    expect(filesystemIndex).toBeGreaterThanOrEqual(0);
    expect(fallbackRoute).toEqual({
      dest: "/404.html",
      headers: { "content-security-policy": "default-src 'none'" },
      src: "^/.*$",
      status: 404,
    });
    expect(config.routes.slice(filesystemIndex + 1, -1)).not.toContainEqual(
      expect.objectContaining({
        headers: { "content-security-policy": "default-src 'none'" },
      }),
    );
  });

  it("publishes only deployable files and replaces stale Vercel output", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-vercel-"));
    const outDir = join(root, "dist");

    try {
      await mkdir(join(outDir, "assets"), { recursive: true });
      await mkdir(join(root, ".vercel", "output", "static"), { recursive: true });
      await writeFile(join(outDir, "index.html"), "home");
      await writeFile(join(outDir, "demiurge-manifest.json"), "{}");
      await writeFile(join(outDir, "demiurge-static-manifest.json"), "{}");
      await writeFile(join(outDir, "assets", "app-12345678.js"), "app");
      await writeFile(join(root, ".vercel", "output", "static", "stale.txt"), "stale");

      await expect(generateVercelStaticOutput({
        deployment: vercelStatic(),
        manifest,
        outDir,
        projectRoot: root,
      })).resolves.toBe(join(root, ".vercel", "output"));

      await expect(readFile(
        join(root, ".vercel", "output", "static", "index.html"),
        "utf8",
      )).resolves.toBe("home");
      await expect(readFile(
        join(root, ".vercel", "output", "static", "assets", "app-12345678.js"),
        "utf8",
      )).resolves.toBe("app");
      await expect(readFile(
        join(root, ".vercel", "output", "config.json"),
        "utf8",
      )).resolves.toMatch(/"version": 3\n}\n$/);
      await expect(readFile(
        join(root, ".vercel", "output", "static", "demiurge-manifest.json"),
      )).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(
        join(root, ".vercel", "output", "static", "stale.txt"),
      )).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects unsafe output overlap and invalid adapter rules", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-vercel-invalid-"));

    try {
      await expect(generateVercelStaticOutput({
        deployment: vercelStatic(),
        manifest,
        outDir: join(root, ".vercel", "output", "static"),
        projectRoot: root,
      })).rejects.toThrow(/must not overlap/);
      await expect(generateVercelStaticOutput({
        deployment: {
          adapter: "vercel",
          cache: [{ source: "", value: "" }],
        },
        manifest,
        outDir: join(root, "dist"),
        projectRoot: root,
      })).rejects.toThrow(/header rule/);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a missing fallback and an invalid Vercel cache rule", () => {
    expect(() => createVercelOutputConfig(
      { ...manifest, entries: manifest.entries.filter((entry) => entry.pathname !== "*") },
      vercelStatic(),
    )).toThrow(/fallback/);
    expect(() => createVercelOutputConfig(
      manifest,
      vercelStatic({
        cache: [{ source: "/videos/(", value: "public, max-age=60" }],
      }),
    )).toThrow(/header rule is not valid/);
  });

  it("translates a static file header pattern rule to a Vercel route", () => {
    const config = createVercelOutputConfig(
      {
        ...manifest,
        fileHeaderRules: [
          {
            headers: { "cross-origin-resource-policy": "cross-origin" },
            pattern: "\\.woff2$",
          },
          ...manifest.fileHeaderRules,
        ],
      },
      vercelStatic(),
    );

    const declaredRule = {
      continue: true,
      headers: { "cross-origin-resource-policy": "cross-origin" },
      src: "^/(?:.*/)?[^/]*(?:\\.woff2)$",
    };

    expect(config.routes).toContainEqual(declaredRule);

    const result = evaluateRouting(config, "/assets/font-12345678.woff2");
    expect(result.headers["cross-origin-resource-policy"]).toBe("cross-origin");
  });

  it.each(["/assets/app-12345678.js", "/assets/app-Abcd_123.css"])(
    "sets immutable caching before file lookup for %s",
    (pathname) => {
      const config = createVercelOutputConfig(manifest, vercelStatic());
      const routing = evaluateRouting(config, pathname);
      expect(routing.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
      expect(routing.status).toBe(200);
      expect(routing.pathname).toBe(pathname);
    },
  );

  it("revalidates an unhashed public file before file lookup", () => {
    const config = createVercelOutputConfig(manifest, vercelStatic());
    const routing = evaluateRouting(config, "/site.webmanifest");
    expect(routing.headers["cache-control"]).toBe("public, max-age=0, must-revalidate");
  });

  it("preserves an entry cache policy after generic file rules", () => {
    const config = createVercelOutputConfig(manifest, vercelStatic());
    const routing = evaluateRouting(config, "/robots.txt");
    expect(routing.headers["cache-control"]).toBe("public, max-age=60");
    expect(routing.status).toBe(200);
  });

  it.each(["/site.webmanifest", "/assets/app-12345678.js", "/robots.txt"])(
    "preserves the application cache policy for %s",
    (pathname) => {
      const config = createVercelOutputConfig(
        manifest,
        vercelStatic({ cache: [{ source: pathname, value: "public, max-age=3600" }] }),
      );
      const routing = evaluateRouting(config, pathname);
      expect(routing.headers["cache-control"]).toBe("public, max-age=3600");
      expect(routing.status).toBe(200);
    },
  );

  it("preserves entry policy through a physical file alias", () => {
    const config = createVercelOutputConfig(manifest, vercelStatic());
    const routing = evaluateRouting(config, "/about/index.html");
    expect(routing.pathname).toBe("/about");
    expect(routing.headers["content-security-policy"]).toBe("default-src 'self'");
    expect(routing.status).toBe(200);
  });

  it("uses fallback policy after a missing hashed file", () => {
    const config = createVercelOutputConfig(manifest, vercelStatic());
    const routing = evaluateRouting(config, "/assets/missing-12345678.js");
    expect(routing.pathname).toBe("/404.html");
    expect(routing.status).toBe(404);
    expect(routing.headers["content-security-policy"]).toBe("default-src 'none'");
    expect(routing.headers["cache-control"]).toBe("public, max-age=0, must-revalidate");
  });

  it("removes file-only headers from documents and missing-file fallbacks", () => {
    const config = createVercelOutputConfig({
      ...manifest,
      fileHeaderRules: [{
        pattern: "\\.woff2$",
        headers: {
          "cross-origin-resource-policy": "cross-origin",
          "x-file-only": "font",
        },
      }, {
        pattern: ".*",
        headers: { "x-file-only": "asset" },
      }, ...manifest.fileHeaderRules],
    }, vercelStatic());

    expect(evaluateRouting(config, "/assets/font-12345678.woff2").headers)
      .toMatchObject({
        "cross-origin-resource-policy": "cross-origin",
        "x-file-only": "font",
      });
    for (const pathname of ["/", "/about/index.html", "/404.html"]) {
      expect(evaluateRouting(config, pathname).headers).not.toHaveProperty("x-file-only");
    }
    const fallback = evaluateRouting(config, "/assets/missing-12345678.woff2");
    expect(fallback.status).toBe(404);
    expect(fallback.headers).not.toHaveProperty("cross-origin-resource-policy");
    expect(fallback.headers).not.toHaveProperty("x-file-only");
    expect(fallback.headers["content-security-policy"]).toBe("default-src 'none'");
    expect(fallback.headers["access-control-allow-origin"]).toBe("https://example.test");
  });

  it("keeps an explicit document header over a different file policy", () => {
    const config = createVercelOutputConfig({
      ...manifest,
      entries: manifest.entries.map((entry) => ({
        ...entry,
        headers: { ...entry.headers, "cross-origin-resource-policy": "same-origin" },
      })),
      fileHeaderRules: [{
        pattern: ".*",
        headers: { "cross-origin-resource-policy": "cross-origin" },
      }, ...manifest.fileHeaderRules],
    }, vercelStatic());
    for (const pathname of ["/", "/about/index.html", "/404.html", "/missing.woff2"]) {
      expect(evaluateRouting(config, pathname).headers["cross-origin-resource-policy"])
        .toBe("same-origin");
    }
  });

  it("preserves an application cache rule on the error response", () => {
    const config = createVercelOutputConfig(
      manifest,
      vercelStatic({ cache: [{ source: "/missing.txt", value: "public, max-age=30" }] }),
    );
    const routing = evaluateRouting(config, "/missing.txt");
    expect(routing.status).toBe(404);
    expect(routing.headers["cache-control"]).toBe("public, max-age=30");
  });

  it("preserves an explicit fallback cache policy", () => {
    const config = createVercelOutputConfig(
      {
        ...manifest,
        entries: manifest.entries.map((entry) => entry.pathname === "*"
          ? { ...entry, headers: { ...entry.headers, "cache-control": "no-store" } }
          : entry),
      },
      vercelStatic(),
    );
    const routing = evaluateRouting(config, "/assets/missing-12345678.js");
    expect(routing.status).toBe(404);
    expect(routing.headers["cache-control"]).toBe("no-store");
  });

  it("reflects a declared Vercel CORS policy in access-control-allow-origin", () => {
    const config = createVercelOutputConfig(
      manifest,
      vercelStatic({ cors: { origins: ["https://app.example.test"] } }),
    );

    expect(config.routes[0]).toEqual({
      continue: true,
      headers: {
        "access-control-allow-origin": "https://app.example.test",
      },
      src: "^/.*$",
    });
  });

  it("reflects a wildcard Vercel CORS policy", () => {
    const config = createVercelOutputConfig(
      manifest,
      vercelStatic({ cors: { origins: "*" } }),
    );

    expect(config.routes[0]).toEqual({
      continue: true,
      headers: { "access-control-allow-origin": "*" },
      src: "^/.*$",
    });
  });

  it("falls back to the build origin without a declared CORS policy", () => {
    const config = createVercelOutputConfig(manifest, vercelStatic());

    expect(config.routes[0]).toEqual({
      continue: true,
      headers: {
        "access-control-allow-origin": "https://example.test",
      },
      src: "^/.*$",
    });
  });

  it("rejects a Vercel CORS policy that declares more than one origin", () => {
    expect(() => createVercelOutputConfig(
      manifest,
      vercelStatic({
        cors: { origins: ["https://a.example.test", "https://b.example.test"] },
      }),
    )).toThrow(/must declare the wildcard origin or exactly one origin/);
  });

  it("rejects Vercel static output with no CORS policy and no build origin", () => {
    expect(() => createVercelOutputConfig(
      { ...manifest, origin: undefined },
      vercelStatic(),
    )).toThrow(/requires a build origin/);
  });
});
