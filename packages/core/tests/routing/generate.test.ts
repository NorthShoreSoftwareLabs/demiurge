import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { generateRoutes } from "../../src/routing/generate";

describe("typed route manifest generator", () => {
  it("generates module augmentation for actual file-based URLs", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-routes-"));
    const routesDir = join(root, "routes");
    const outputFile = join(root, "routes.d.ts");

    await mkdir(join(routesDir, "blog"), { recursive: true });
    await mkdir(join(routesDir, "(admin)"), { recursive: true });
    await writeFile(join(routesDir, "index.tsx"), "export {}");
    await writeFile(join(routesDir, "blog", "index.tsx"), "export {}");
    await writeFile(join(routesDir, "blog", "[slug].tsx"), "export {}");
    await writeFile(join(routesDir, "(admin)", "users.tsx"), "export {}");
    await writeFile(join(routesDir, "@error.tsx"), "export {}");
    await writeFile(join(routesDir, "@layout.tsx"), "export {}");
    await writeFile(join(routesDir, "@loading.tsx"), "export {}");
    await writeFile(join(routesDir, "@middleware.ts"), "export {}");
    await writeFile(
      join(routesDir, "(admin)", "@middleware.ts"),
      "export const middleware = undefined;",
    );
    await writeFile(join(routesDir, "@not-found.tsx"), "export {}");
    await writeFile(join(routesDir, "@policy.ts"), "export {}");

    await generateRoutes({ outputFile, routesDir });

    const source = await readFile(outputFile, "utf8");

    expect(source).toContain('"/": {};');
    expect(source).toContain('"/blog": {};');
    expect(source).toContain('"/blog/[slug]": { slug: PathValue };');
    expect(source).toContain('"/blog/[slug]": `/blog/${PathValue}`;');
    expect(source).toContain(
      '"/blog/[slug]": MutationMethodsOf<typeof import("./routes/blog/[slug]")>;',
    );
    expect(source).toContain('"/users": {};');
    expect(source).not.toContain("@error");
    expect(source).not.toContain("@layout");
    expect(source).not.toContain("@loading");
    expect(source).not.toContain("@not-found");
    expect(source).not.toContain("@policy");
  });

  it("uses declaration-only route module types for mutation methods", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-route-mutations-"));
    const routesDir = join(root, "src", "routes");
    const outputFile = join(root, ".demiurge", "route-manifest.d.ts");

    await mkdir(join(routesDir, "projects"), { recursive: true });
    await writeFile(
      join(routesDir, "projects", "[id].tsx"),
      'export const PATCH = "server handler";',
    );

    await generateRoutes({ outputFile, routesDir });

    const source = await readFile(outputFile, "utf8");
    expect(source).toContain(
      'import type { MiddlewareContextOf, MutationMethodsOf, PathValue } from "@demiurgejs/core";',
    );
    expect(source).toContain(
      '"/projects/[id]": MutationMethodsOf<typeof import("../src/routes/projects/[id]")>;',
    );
    expect(source).not.toContain("server handler");
  });

  it("maps each route to the branded contributions from ancestor middleware", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-route-context-"));
    const routesDir = join(root, "src", "routes");
    const outputFile = join(root, ".demiurge", "route-manifest.d.ts");

    await mkdir(join(routesDir, "admin"), { recursive: true });
    await writeFile(join(routesDir, "@middleware.ts"), "export const middleware = root;");
    await writeFile(
      join(routesDir, "admin", "@middleware.ts"),
      "export const middleware = admin;",
    );
    await writeFile(join(routesDir, "admin", "index.tsx"), "export {}");
    await writeFile(join(routesDir, "public.tsx"), "export {}");

    await generateRoutes({ outputFile, routesDir });

    const source = await readFile(outputFile, "utf8");

    expect(source).toContain('typeof import("../src/routes/@middleware")');
    expect(source).toContain('typeof import("../src/routes/admin/@middleware")');
    expect(source).toMatch(
      /"\/admin": __DemiurgeMiddlewareContext\d+ & __DemiurgeMiddlewareContext\d+;/,
    );
    expect(source).toMatch(/"\/public": __DemiurgeMiddlewareContext\d+;/);
  });
});
