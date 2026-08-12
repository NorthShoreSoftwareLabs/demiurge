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
  page,
  security,
  structuredData,
  type LayoutProps,
  type NotFoundProps,
  type RouteMiddleware,
  type RouteModule,
  type RouteProps,
} from "@demiurge-js/core";
import {
  generateStaticOutput,
  staticAdapter,
} from "@demiurge-js/core/static";

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
      "./routes/api/health.ts": routeModule({}),
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
    expect(existsSync(join(outDir, "api", "health", "index.html"))).toBe(false);
    expect(persistedManifest).toEqual(manifest);
    expect(manifest.entries.map((entry) => entry.file)).toEqual([
      "404.html",
      "index.html",
      "posts/hello world/index.html",
      "posts/second/index.html",
    ]);
  });

  it("records static CSP headers and accepts correctly hashed inline scripts", async () => {
    const { outDir } = await createOutputDirectory();
    const schema = {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Static example",
    };
    const hash = await cspHash(JSON.stringify(schema));
    const routes = appRoutes({
      "./routes/@policy.ts": routeModule({
        policy: defineRoutePolicy({
          document: security.static({
            csp: { scriptSrc: ["'self'", hash] },
          }),
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

    expect(homeEntry?.headers["content-security-policy"]).toContain(hash);
    expect(home).not.toContain(" nonce=");
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
    ).rejects.toThrow(/nonce-backed CSP/);
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

  it("removes pages generated by the previous static manifest without touching assets", async () => {
    const { outDir } = await createOutputDirectory();

    await generateStaticOutput({
      outDir,
      routes: appRoutes({
        "./routes/old.tsx": routeModule({
          GET: page({ render: { mode: "static" }, view: PlainPage }),
        }),
      }),
    });
    expect(existsSync(join(outDir, "old", "index.html"))).toBe(true);

    await generateStaticOutput({ outDir, routes: appRoutes() });

    expect(existsSync(join(outDir, "old", "index.html"))).toBe(false);
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
        routes: { "./routes/api/health.ts": routeModule({}) },
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
