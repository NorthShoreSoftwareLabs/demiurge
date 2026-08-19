import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defineFonts, font } from "@demiurgejs/core";
import { resolveFontAssets } from "../../src/platform/font-assets";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

async function createProject() {
  const root = await mkdtemp(join(tmpdir(), "demiurge-fonts-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "fonts"), { recursive: true });
  await writeFile(join(root, "fonts", "brand.woff2"), new Uint8Array([1, 2, 3]));

  return root;
}

function decode(body: Uint8Array) {
  return new TextDecoder().decode(body);
}

const brand = font.local({
  name: "Brand Sans",
  src: "fonts/brand.woff2",
  weight: "400 700",
});

describe("font asset emission", () => {
  it("publishes every declared font file and one stylesheet", async () => {
    const root = await createProject();
    const assets = await resolveFontAssets({
      fonts: defineFonts([brand]),
      root,
    });

    expect(assets.map((asset) => asset.file)).toEqual([
      "_demiurge/font/brand-sans-400-700-normal.woff2",
      "_demiurge/font/fonts.css",
    ]);
    expect(assets[0]!.body).toEqual(new Uint8Array([1, 2, 3]));
    expect(assets[0]!.contentType).toBe("font/woff2");
    expect(assets[1]!.contentType).toBe("text/css; charset=utf-8");
    expect(decode(assets[1]!.body)).toContain(
      'src: url("/_demiurge/font/brand-sans-400-700-normal.woff2") format("woff2")',
    );
  });

  it("emits nothing when the application declares no font", async () => {
    const root = await createProject();

    await expect(resolveFontAssets({ root })).resolves.toEqual([]);
  });

  it("declares a hosted font in the stylesheet without publishing a file", async () => {
    const root = await createProject();
    const assets = await resolveFontAssets({
      fonts: defineFonts([
        font.google({
          family: "Inter",
          selfHost: false,
          src: "https://fonts.gstatic.com/s/inter/inter.woff2",
        }),
      ]),
      root,
    });

    expect(assets.map((asset) => asset.file)).toEqual([
      "_demiurge/font/fonts.css",
    ]);
    expect(decode(assets[0]!.body)).toContain(
      'url("https://fonts.gstatic.com/s/inter/inter.woff2")',
    );
  });

  it("downloads a hosted font once and reads the cache after that", async () => {
    const root = await createProject();
    const cacheDir = join(root, "cache");
    const requested: string[] = [];
    const fonts = defineFonts([
      font.google({
        family: "Inter",
        src: "https://fonts.gstatic.com/s/inter/inter.woff2",
      }),
    ]);
    const assets = await resolveFontAssets({
      cacheDir,
      fetch: async (input) => {
        requested.push(input);

        return new Response(new Uint8Array([9, 8, 7]));
      },
      fonts,
      root,
    });

    expect(requested).toEqual([
      "https://fonts.gstatic.com/s/inter/inter.woff2",
    ]);
    expect(assets[0]!.file).toBe("_demiurge/font/inter-400-normal.woff2");
    expect(assets[0]!.body).toEqual(new Uint8Array([9, 8, 7]));
    await expect(readdir(cacheDir)).resolves.toHaveLength(1);

    const cached = await resolveFontAssets({
      cacheDir,
      fetch: async () => {
        throw new Error("The cached build must not reach the font host.");
      },
      fonts,
      root,
    });

    expect(cached[0]!.body).toEqual(new Uint8Array([9, 8, 7]));
  });

  it("reports a font host that refuses the download", async () => {
    const root = await createProject();

    await expect(resolveFontAssets({
      cacheDir: join(root, "cache"),
      fetch: async () => new Response("no", { status: 403 }),
      fonts: defineFonts([
        font.google({
          family: "Inter",
          src: "https://fonts.gstatic.com/s/inter/inter.woff2",
        }),
      ]),
      root,
    })).rejects.toThrow('The font host answered 403 for family "Inter"');
  });

  it("reports a font host it cannot reach", async () => {
    const root = await createProject();

    await expect(resolveFontAssets({
      cacheDir: join(root, "cache"),
      fetch: async () => {
        throw new Error("offline");
      },
      fonts: defineFonts([
        font.google({
          family: "Inter",
          src: "https://fonts.gstatic.com/s/inter/inter.woff2",
        }),
      ]),
      root,
    })).rejects.toThrow("could not download the font for family");
  });

  it("reports a source the build cannot read", async () => {
    const root = await createProject();

    await expect(resolveFontAssets({
      fonts: defineFonts([font.local({ name: "Missing", src: "fonts/none.woff2" })]),
      root,
    })).rejects.toThrow("could not read the font file");
  });

  it("keeps a font source inside the project directory", async () => {
    const root = await createProject();

    await expect(resolveFontAssets({
      fonts: defineFonts([
        font.local({ name: "Escape", src: "../outside.woff2" }),
      ]),
      root,
    })).rejects.toThrow("escaped the project directory");
  });

  it("rejects an empty file and a file above the size limit", async () => {
    const root = await createProject();
    await writeFile(join(root, "fonts", "empty.woff2"), new Uint8Array());

    await expect(resolveFontAssets({
      fonts: defineFonts([
        font.local({ name: "Empty", src: "fonts/empty.woff2" }),
      ]),
      root,
    })).rejects.toThrow("resolved to an empty file");

    await writeFile(
      join(root, "fonts", "huge.woff2"),
      new Uint8Array(5 * 1024 * 1024 + 1),
    );

    await expect(resolveFontAssets({
      fonts: defineFonts([font.local({ name: "Huge", src: "fonts/huge.woff2" })]),
      root,
    })).rejects.toThrow("is larger than the");
  });

  it("stops when two declarations claim the same published file", async () => {
    const root = await createProject();
    await writeFile(join(root, "fonts", "other.woff2"), new Uint8Array([4]));

    await expect(resolveFontAssets({
      fonts: defineFonts([
        font.local({ name: "Brand Sans", src: "fonts/brand.woff2" }),
        font.local({ name: "Brand Sans", src: "fonts/other.woff2" }),
      ]),
      root,
    })).rejects.toThrow("publish the same file");
  });

  it("publishes one file when a family repeats the same source", async () => {
    const root = await createProject();
    const assets = await resolveFontAssets({
      fonts: defineFonts([brand, brand]),
      root,
    });

    expect(assets.map((asset) => asset.file)).toEqual([
      "_demiurge/font/brand-sans-400-700-normal.woff2",
      "_demiurge/font/fonts.css",
    ]);
  });
});
