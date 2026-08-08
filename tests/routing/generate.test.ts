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
    await writeFile(join(routesDir, "@layout.tsx"), "export {}");
    await writeFile(join(routesDir, "@policy.ts"), "export {}");

    await generateRoutes({ outputFile, routesDir });

    const source = await readFile(outputFile, "utf8");

    expect(source).toContain('"/": {};');
    expect(source).toContain('"/blog": {};');
    expect(source).toContain('"/blog/[slug]": { slug: PathValue };');
    expect(source).toContain('"/blog/[slug]": `/blog/${PathValue}`;');
    expect(source).toContain('"/users": {};');
    expect(source).not.toContain("@layout");
    expect(source).not.toContain("@policy");
    expect(source).not.toContain("(admin)");
  });
});
