import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cspHash,
  defineMetadata,
  defineRoutePolicy,
  defineScripts,
  page,
  security,
  script,
  structuredData,
  text,
  type LayoutProps,
  type NotFoundProps,
  type RouteMiddleware,
  type RouteModule,
  type RouteProps,
} from "@demiurgejs/core";
import {
  generateStaticOutput,
  staticAdapter,
} from "@demiurgejs/core/static";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

function routeModule(module: RouteModule) {
  return vi.fn(async () => module);
}

function Home({ data }: RouteProps<string, { message: string }>) {
  return <main>{data.message}</main>;
}

function Post({ path }: RouteProps) {
  return <article>Post {path.slug}</article>;
}

function Layout({ children }: LayoutProps) {
  return <div className="shell">{children}</div>;
}

function NotFound({ pathname }: NotFoundProps) {
  return <main>Nothing at {pathname}</main>;
}

function ThrowPage(): never {
  throw new Error("render failed");
}

function PlainPage() {
  return <main>Plain page</main>;
}

function InlineScriptPage() {
  return (
    <main>
      <script dangerouslySetInnerHTML={{ __html: "window.appInline = true;" }} />
    </main>
  );
}

function InlineStylePage() {
  return <main style={{ opacity: 0.8 }}>Styled page</main>;
}

function InlineStyleElementPage() {
  return (
    <>
      <style>{".styled-page { opacity: 0.8; }"}</style>
      <main className="styled-page">Styled page</main>
    </>
  );
}

function InlineStylesPage() {
  return (
    <>
      <style>{".styled-page { opacity: 0.8; }"}</style>
      <main className="styled-page" style={{ color: "blue" }}>Styled page</main>
    </>
  );
}

async function createOutputDirectory() {
  const root = await mkdtemp(join(tmpdir(), "demiurge-static-output-"));
  const outDir = join(root, "dist");
  temporaryRoots.push(root);
  await mkdir(join(outDir, "assets"), { recursive: true });
  await writeFile(join(outDir, "assets", "app-a1b2c3d4.js"), "export {};\n");
  await writeFile(join(outDir, "index.html"), "client shell");
  return { outDir, root };
}

function appRoutes(extra: Record<string, ReturnType<typeof routeModule>> = {}) {
  return {
    "./routes/@layout.tsx": routeModule({ default: Layout }),
    "./routes/@not-found.tsx": routeModule({ default: NotFound }),
    "./routes/index.tsx": routeModule({
      GET: page<string, { message: string }>({
        data: async () => ({ message: "Built at export time" }),
        render: { mode: "static" },
        view: Home,
      }),
      metadata: defineMetadata({ title: "Static home" }),
    }),
    ...extra,
  };
}

describe("static output adapter", () => {
  it("limits concurrent route module loading", async () => {
    const { outDir } = await createOutputDirectory();
    let active = 0;
    let maximumActive = 0;
    const resourceRoutes = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [
        `./routes/resources/${index}.txt.ts`,
        async () => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return { GET: text(`resource ${index}`) } satisfies RouteModule;
        },
      ]),
    );
    const routes = {
      ...appRoutes(),
      ...resourceRoutes,
    };

    await generateStaticOutput({ outDir, routes });

    expect(maximumActive).toBe(8);
  });

  it("declares only the static output capability", () => {
    expect(staticAdapter).toEqual({
      capabilities: {
        backgroundLifetime: false,
        crossOriginIsolationHeaders: false,
        nonceInjection: false,
        sharedCache: false,
        staticOutput: true,
        streaming: false,
        webSocket: false,
        webTransport: false,
      },
      name: "static",
    });
  });

  it("renders static and dynamic pages, preserves assets, and emits a 404 and manifest", async () => {
    const { outDir } = await createOutputDirectory();
    const routes = appRoutes({
      "./routes/robots.txt.ts": routeModule({
        GET: text("User-agent: *\nAllow: /\n"),
      }),
      "./routes/sitemap.xml.ts": routeModule({
        GET: text("<urlset></urlset>\n", {
          headers: { "content-type": "application/xml; charset=utf-8" },
        }),
      }),
      "./routes/posts/[slug].tsx": routeModule({
        GET: page({ render: { mode: "static" }, view: Post }),
        paths: async () => [{ slug: "hello world" }, { slug: "second" }],
      }),
    });

    const manifest = await generateStaticOutput({
      origin: "https://static.example.test",
      outDir,
      routes,
      ssr: {
        clientEntry: "/assets/app-a1b2c3d4.js",
        styles: ["/assets/app-a1b2c3d4.css"],
      },
    });

    const home = await readFile(join(outDir, "index.html"), "utf8");
    const post = await readFile(
      join(outDir, "posts", "hello world", "index.html"),
      "utf8",
    );
    const notFound = await readFile(join(outDir, "404.html"), "utf8");
    const persistedManifest = JSON.parse(
      await readFile(join(outDir, "demiurge-static-manifest.json"), "utf8"),
    );

    expect(home).toContain("Built at export time");
    expect(home).toContain("<title>Static home</title>");
    expect(home).toContain('<template id="__demiurge_data">');
    expect(home).toContain('"navigation":"document"');
    expect(home).toContain('src="/assets/app-a1b2c3d4.js"');
    expect(home).toContain('href="/assets/app-a1b2c3d4.css"');
    expect(post).toContain("Post");
    expect(post).toContain("hello world");
    expect(notFound).toContain("Nothing at");
    expect(notFound).toContain("/404");
    expect(notFound).toContain('"navigation":"document"');
    expect(await readFile(join(outDir, "assets", "app-a1b2c3d4.js"), "utf8"))
      .toBe("export {};\n");
    expect(await readFile(join(outDir, "robots.txt"), "utf8")).toBe(
      "User-agent: *\nAllow: /\n",
    );
    expect(await readFile(join(outDir, "sitemap.xml"), "utf8")).toBe(
      "<urlset></urlset>\n",
    );
    expect(persistedManifest).toEqual(manifest);
    expect(manifest.entries.every((entry) => !("kind" in entry))).toBe(true);
    expect(manifest.fileHeaderRules).toEqual([
      {
        headers: {
          "cache-control": "public, max-age=31536000, immutable",
        },
        pattern: "-[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9]+$",
      },
      {
        headers: {
          "cache-control": "public, max-age=0, must-revalidate",
        },
        pattern: ".*",
      },
    ]);
    expect(manifest.entries.map((entry) => entry.file)).toEqual([
      "404.html",
      "index.html",
      "posts/hello world/index.html",
      "posts/second/index.html",
      "robots.txt",
      "sitemap.xml",
    ]);
    expect(
      manifest.entries.find((entry) => entry.file === "sitemap.xml")?.headers["content-type"],
    ).toBe("application/xml; charset=utf-8");
  });

  it("rejects route capabilities that require a runtime adapter", async () => {
    const dynamic = await createOutputDirectory();
    const mutation = await createOutputDirectory();

    await expect(
      generateStaticOutput({
        outDir: dynamic.outDir,
        routes: appRoutes({
          "./routes/request.txt.ts": routeModule({
            GET: text(({ request }) => request.url),
          }),
        }),
      }),
    ).rejects.toThrow(
      /"\.\/routes\/request\.txt\.ts" uses a request-dependent text value/,
    );

    await expect(
      generateStaticOutput({
        outDir: mutation.outDir,
        routes: appRoutes({
          "./routes/submit.ts": routeModule({
            GET: text("ready"),
            POST: text("accepted"),
          }),
        }),
      }),
    ).rejects.toThrow(/"\.\/routes\/submit\.ts" exports unsupported methods POST/);
  });

  it("adds static CSP hashes for framework-rendered structured data", async () => {
    const { outDir } = await createOutputDirectory();
    const schema = {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Static </script> example\u2028line\u2029end",
    };
    const routes = appRoutes({
      "./routes/@policy.ts": routeModule({
        policy: defineRoutePolicy({
          document: security.static(),
        }),
      }),
      "./routes/index.tsx": routeModule({
        GET: page<string, { message: string }>({
          data: async () => ({ message: "Secure static page" }),
          render: { mode: "static" },
          view: Home,
        }),
        metadata: defineMetadata({
          structuredData: [structuredData(schema)],
        }),
      }),
    });

    const manifest = await generateStaticOutput({ outDir, routes });
    const homeEntry = manifest.entries.find((entry) => entry.pathname === "/");
    const home = await readFile(join(outDir, "index.html"), "utf8");
    const structuredDataSource = home.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    )?.[1];
    const hash = await cspHash(structuredDataSource ?? "");

    expect(homeEntry?.headers["content-security-policy"]).toContain(hash);
    expect(homeEntry?.headers["content-security-policy"])
      .not.toContain("'unsafe-inline'");
    expect(home).toContain('<script type="application/ld+json">');
    expect(home).toContain("\\u003c/script\\u003e");
    expect(home).toContain("\\u2028");
    expect(home).toContain("\\u2029");
    expect(home).not.toContain("data-demiurge-structured-data");
    expect(home).not.toContain(" nonce=");
  });

  it("rejects application-authored inline scripts without a declared hash", async () => {
    const { outDir } = await createOutputDirectory();
    const routes = appRoutes({
      "./routes/@policy.ts": routeModule({
        policy: defineRoutePolicy({ document: security.static() }),
      }),
      "./routes/index.tsx": routeModule({
        GET: page({ render: { mode: "static" }, view: InlineScriptPage }),
      }),
    });

    await expect(generateStaticOutput({ outDir, routes })).rejects.toThrow(
      /inline script without the required CSP hash/,
    );
  });

  it("reports the route, script, and effective script-src for a blocked static script", async () => {
    const { outDir } = await createOutputDirectory();
    const routes = appRoutes({
      "./routes/@policy.ts": routeModule({
        policy: defineRoutePolicy({ document: security.static() }),
      }),
      "./routes/index.tsx": routeModule({
        GET: page({ render: { mode: "static" }, view: PlainPage }),
        scripts: defineScripts([
          script({ src: "https://cdn.example.com/app.js" }),
        ]),
      }),
    });

    await expect(generateStaticOutput({ outDir, routes })).rejects.toThrow(
      /Route "\.\/routes\/index\.tsx" export GET declares script "https:\/\/cdn\.example\.com\/app\.js" that violates the effective script-src 'self' policy\./,
    );
  });

  it("does not treat unsafe-inline as external script authorization", async () => {
    const { outDir } = await createOutputDirectory();
    const routes = appRoutes({
      "./routes/@policy.ts": routeModule({
        policy: defineRoutePolicy({
          document: security.static({
            csp: { scriptSrc: ["'unsafe-inline'"] },
          }),
        }),
      }),
      "./routes/index.tsx": routeModule({
        GET: page({ render: { mode: "static" }, view: PlainPage }),
        scripts: defineScripts([
          script({ src: "https://cdn.example.com/app.js" }),
        ]),
      }),
    });

    await expect(generateStaticOutput({ outDir, routes })).rejects.toThrow(
      /violates the effective script-src 'self' 'unsafe-inline' policy\./,
    );
  });

  it("matches wildcard hosts and exact host-source paths", async () => {
    const { outDir } = await createOutputDirectory();
    const routes = appRoutes({
      "./routes/@policy.ts": routeModule({
        policy: defineRoutePolicy({
          document: security.static({
            csp: {
              scriptSrc: ["https://*.example.com/app.js"],
            },
          }),
        }),
      }),
      "./routes/index.tsx": routeModule({
        GET: page({ render: { mode: "static" }, view: PlainPage }),
        scripts: defineScripts([
          script({ src: "https://cdn.example.com/app.js" }),
        ]),
      }),
    });

    await expect(generateStaticOutput({ outDir, routes })).resolves.toBeDefined();
  });

  it("rejects a script outside an exact host-source path", async () => {
    const { outDir } = await createOutputDirectory();
    const routes = appRoutes({
      "./routes/@policy.ts": routeModule({
        policy: defineRoutePolicy({
          document: security.static({
            csp: { scriptSrc: ["https://cdn.example.com/app.js"] },
          }),
        }),
      }),
      "./routes/index.tsx": routeModule({
        GET: page({ render: { mode: "static" }, view: PlainPage }),
        scripts: defineScripts([
          script({ src: "https://cdn.example.com/app.js.evil" }),
        ]),
      }),
    });

    await expect(generateStaticOutput({ outDir, routes })).rejects.toThrow(
      /violates the effective script-src .*https:\/\/cdn\.example\.com\/app\.js policy\./,
    );
  });

  it("keeps host sources active when strict-dynamic has no nonce or hash", async () => {
    const { outDir } = await createOutputDirectory();
    const routes = appRoutes({
      "./routes/@policy.ts": routeModule({
        policy: defineRoutePolicy({
          document: security.static({
            csp: { scriptSrc: ["https://cdn.example.com", "'strict-dynamic'"] },
          }),
        }),
      }),
      "./routes/index.tsx": routeModule({
        GET: page({ render: { mode: "static" }, view: PlainPage }),
        scripts: defineScripts([
          script({ src: "https://cdn.example.com/app.js" }),
        ]),
      }),
    });

    await expect(generateStaticOutput({ outDir, routes })).resolves.toBeDefined();
  });

  it("allows a static script source declared through security.needs.script", async () => {
    const { outDir } = await createOutputDirectory();
    const routes = appRoutes({
      "./routes/@policy.ts": routeModule({
        policy: defineRoutePolicy({
          document: security.static(),
          security: {
            needs: { script: ["https://cdn.example.com"] },
          },
        }),
      }),
      "./routes/index.tsx": routeModule({
        GET: page({ render: { mode: "static" }, view: PlainPage }),
        scripts: defineScripts([
          script({ src: "https://cdn.example.com/app.js" }),
        ]),
      }),
    });

    const manifest = await generateStaticOutput({ outDir, routes });
    const home = await readFile(join(outDir, "index.html"), "utf8");
    const entry = manifest.entries.find((item) => item.pathname === "/");

    expect(home).toContain('src="https://cdn.example.com/app.js"');
    expect(entry?.headers["content-security-policy"]).toContain(
      "script-src 'self' https://cdn.example.com",
    );
  });

  it("accepts style attributes through style-src-attr", async () => {
    const { outDir } = await createOutputDirectory();
    const routes = appRoutes({
      "./routes/@policy.ts": routeModule({
        policy: defineRoutePolicy({
          document: security.static({
            csp: { styleSrcAttr: ["'unsafe-inline'"] },
          }),
        }),
      }),
      "./routes/index.tsx": routeModule({
        GET: page({ render: { mode: "static" }, view: InlineStylePage }),
      }),
    });

    const manifest = await generateStaticOutput({ outDir, routes });
    const homeEntry = manifest.entries.find((entry) => entry.pathname === "/");
    const home = await readFile(join(outDir, "index.html"), "utf8");

    expect(homeEntry?.headers["content-security-policy"]).toContain(
      "style-src-attr 'unsafe-inline'",
    );
    expect(home).toContain('style="opacity:0.8"');
  });

  it("rejects style attributes when style-src-attr falls back to style-src", async () => {
    const { outDir } = await createOutputDirectory();
    const routes = appRoutes({
      "./routes/@policy.ts": routeModule({
        policy: defineRoutePolicy({ document: security.static() }),
      }),
      "./routes/index.tsx": routeModule({
        GET: page({ render: { mode: "static" }, view: InlineStylePage }),
      }),
    });

    await expect(generateStaticOutput({ outDir, routes })).rejects.toThrow(
      /inline style attribute that its CSP does not allow/,
    );
  });

  it("accepts style elements through style-src-elem", async () => {
    const { outDir } = await createOutputDirectory();
    const routes = appRoutes({
      "./routes/@policy.ts": routeModule({
        policy: defineRoutePolicy({
          document: security.static({
            csp: { styleSrcElem: ["'unsafe-inline'"] },
          }),
        }),
      }),
      "./routes/index.tsx": routeModule({
        GET: page({
          render: { mode: "static" },
          view: InlineStyleElementPage,
        }),
      }),
    });

    const manifest = await generateStaticOutput({ outDir, routes });
    const homeEntry = manifest.entries.find((entry) => entry.pathname === "/");

    expect(homeEntry?.headers["content-security-policy"]).toContain(
      "style-src-elem 'unsafe-inline'",
    );
  });

  it("allows inline styles when the CSP has no effective style directive", async () => {
    const { outDir } = await createOutputDirectory();
    const routes = appRoutes({
      "./routes/@policy.ts": routeModule({
        policy: defineRoutePolicy({
          document: { csp: { baseUri: ["'self'"] } },
        }),
      }),
      "./routes/index.tsx": routeModule({
        GET: page({ render: { mode: "static" }, view: InlineStylesPage }),
      }),
    });

    await expect(generateStaticOutput({ outDir, routes })).resolves.toBeDefined();
  });

  it("checks style elements against the style-src fallback", async () => {
    const { outDir } = await createOutputDirectory();
    const routes = appRoutes({
      "./routes/@policy.ts": routeModule({
        policy: defineRoutePolicy({
          document: { csp: { styleSrc: ["'self'"] } },
        }),
      }),
      "./routes/index.tsx": routeModule({
        GET: page({ render: { mode: "static" }, view: InlineStyleElementPage }),
      }),
    });

    await expect(generateStaticOutput({ outDir, routes })).rejects.toThrow(
      /inline style without the required CSP hash/,
    );
  });

  it("checks style attributes against the default-src fallback", async () => {
    const { outDir } = await createOutputDirectory();
    const routes = appRoutes({
      "./routes/@policy.ts": routeModule({
        policy: defineRoutePolicy({
          document: { csp: { defaultSrc: ["'self'"] } },
        }),
      }),
      "./routes/index.tsx": routeModule({
        GET: page({ render: { mode: "static" }, view: InlineStylePage }),
      }),
    });

    await expect(generateStaticOutput({ outDir, routes })).rejects.toThrow(
      /inline style attribute that its CSP does not allow/,
    );
  });

  it("does not add script policy to unrelated CSP headers", async () => {
    const { outDir } = await createOutputDirectory();
    const routes = appRoutes({
      "./routes/@policy.ts": routeModule({
        policy: defineRoutePolicy({
          document: {
            csp: { baseUri: ["'self'"] },
            trustedTypes: {
              mode: "report-only",
              policies: ["demiurge"],
              requireFor: ["script"],
            },
          },
        }),
      }),
      "./routes/index.tsx": routeModule({
        GET: page({ render: { mode: "static" }, view: PlainPage }),
        metadata: defineMetadata({
          structuredData: [structuredData({ "@type": "WebSite" })],
        }),
      }),
    });

    const manifest = await generateStaticOutput({ outDir, routes });
    const homeEntry = manifest.entries.find((entry) => entry.pathname === "/");

    expect(homeEntry?.headers["content-security-policy"]).toBe(
      "base-uri 'self'",
    );
    expect(homeEntry?.headers["content-security-policy-report-only"]).toBe(
      "require-trusted-types-for 'script'; trusted-types demiurge",
    );
  });

  it("rejects nonce-backed CSP because a static nonce cannot be fresh per request", async () => {
    const { outDir } = await createOutputDirectory();
    const routes = appRoutes({
      "./routes/@policy.ts": routeModule({
        policy: defineRoutePolicy({ document: security.strict() }),
      }),
    });

    await expect(
      generateStaticOutput({
        outDir,
        routes,
        ssr: { clientEntry: "/assets/app-a1b2c3d4.js" },
      }),
    ).rejects.toThrow(/nonceInjection/);
    await expect(readFile(join(outDir, "index.html"), "utf8"))
      .resolves.toBe("client shell");
  });

  it("does not publish partial HTML when rendering fails", async () => {
    const { outDir } = await createOutputDirectory();
    const onError = vi.fn();
    const routes = appRoutes({
      "./routes/index.tsx": routeModule({
        GET: page({ render: { mode: "static" }, view: ThrowPage }),
      }),
    });

    await expect(
      generateStaticOutput({ onError, outDir, routes }),
    ).rejects.toThrow(/returned status 500/);
    await expect(readFile(join(outDir, "index.html"), "utf8"))
      .resolves.toBe("client shell");
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "render failed" }),
      { pathname: "/", site: "page" },
    );
  });

  it("rejects per-user cookies added by route middleware", async () => {
    const { outDir } = await createOutputDirectory();
    const middleware: RouteMiddleware = async (_context, next) => {
      const response = await next();
      response.headers.append("set-cookie", "session=private; HttpOnly");
      return response;
    };
    const routes = appRoutes({
      "./routes/@middleware.ts": routeModule({ middleware }),
    });

    await expect(generateStaticOutput({ outDir, routes })).rejects.toThrow(
      /attempted to set a cookie/,
    );
  });

  it("removes generated files from the previous static manifest without touching assets", async () => {
    const { outDir } = await createOutputDirectory();

    await generateStaticOutput({
      outDir,
      routes: appRoutes({
        "./routes/old.tsx": routeModule({
          GET: page({ render: { mode: "static" }, view: PlainPage }),
        }),
        "./routes/retired.txt.ts": routeModule({
          GET: text("retired"),
        }),
      }),
    });
    expect(existsSync(join(outDir, "old", "index.html"))).toBe(true);
    expect(existsSync(join(outDir, "retired.txt"))).toBe(true);

    await generateStaticOutput({ outDir, routes: appRoutes() });

    expect(existsSync(join(outDir, "old", "index.html"))).toBe(false);
    expect(existsSync(join(outDir, "retired.txt"))).toBe(false);
    expect(existsSync(join(outDir, "assets", "app-a1b2c3d4.js"))).toBe(true);
  });

  it("fails before writing for duplicate portable paths and traversal segments", async () => {
    const collision = await createOutputDirectory();
    const traversal = await createOutputDirectory();

    await expect(
      generateStaticOutput({
        outDir: collision.outDir,
        routes: appRoutes({
          "./routes/posts/[slug].tsx": routeModule({
            GET: page({ render: { mode: "static" }, view: Post }),
            paths: async () => [{ slug: "Release" }, { slug: "release" }],
          }),
        }),
      }),
    ).rejects.toThrow(/same portable output file/);

    await expect(
      generateStaticOutput({
        outDir: traversal.outDir,
        routes: appRoutes({
          "./routes/docs/[...path].tsx": routeModule({
            GET: page({ render: { mode: "static" }, view: Post }),
            paths: async () => [{ path: "../secret" }],
          }),
        }),
      }),
    ).rejects.toThrow(/unsafe or not portable/);
  });

  it("requires a page app, an app-owned root 404, and a plain HTTP origin", async () => {
    const apiOnly = await createOutputDirectory();
    const missingNotFound = await createOutputDirectory();
    const invalidOrigin = await createOutputDirectory();

    await expect(
      generateStaticOutput({
        outDir: apiOnly.outDir,
        routes: {
          "./routes/api/health.ts": routeModule({ GET: text("healthy") }),
        },
      }),
    ).rejects.toThrow(/at least one page route/);
    await expect(
      generateStaticOutput({
        outDir: missingNotFound.outDir,
        routes: {
          "./routes/index.tsx": routeModule({
            GET: page({ render: { mode: "static" }, view: PlainPage }),
          }),
        },
      }),
    ).rejects.toThrow(/root @not-found\.tsx/);
    await expect(
      generateStaticOutput({
        origin: "https://user@example.test/base?preview=1",
        outDir: invalidOrigin.outDir,
        routes: appRoutes(),
      }),
    ).rejects.toThrow(/must be an HTTP\(S\) origin/);
  });
});
