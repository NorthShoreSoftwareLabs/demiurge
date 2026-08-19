import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defineFonts, font } from "@demiurgejs/core";
import { createFontAssetHandler } from "@demiurgejs/core/node";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

async function createRoot() {
  const root = await mkdtemp(join(tmpdir(), "demiurge-font-handler-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "fonts"), { recursive: true });
  await writeFile(join(root, "fonts", "brand.woff2"), new Uint8Array([1, 2, 3]));

  return root;
}

function createHandler(root: string) {
  return createFontAssetHandler({
    fonts: defineFonts([
      font.local({ name: "Brand Sans", src: "fonts/brand.woff2" }),
    ]),
    root,
  });
}

function fontRequest(
  pathname: string,
  init: { ifNoneMatch?: string; method?: string } = {},
) {
  const headers = new Headers();

  if (init.ifNoneMatch) {
    headers.set("if-none-match", init.ifNoneMatch);
  }

  return new Request(`https://example.test${pathname}`, {
    headers,
    method: init.method ?? "GET",
  });
}

describe("node font asset handler", () => {
  it("serves the self-hosted font file and the stylesheet", async () => {
    const handler = createHandler(await createRoot());
    const file = await handler(
      fontRequest("/_demiurge/font/brand-sans-400-normal.woff2"),
    );

    expect(file?.status).toBe(200);
    expect(file?.headers.get("content-type")).toBe("font/woff2");
    expect(file?.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(new Uint8Array(await file!.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );

    const stylesheet = await handler(fontRequest("/_demiurge/font/fonts.css"));

    expect(stylesheet?.headers.get("content-type")).toBe(
      "text/css; charset=utf-8",
    );
    await expect(stylesheet!.text()).resolves.toContain(
      'font-family: "Brand Sans"',
    );
  });

  it("answers a repeat request with one revalidation", async () => {
    const handler = createHandler(await createRoot());
    const first = await handler(
      fontRequest("/_demiurge/font/brand-sans-400-normal.woff2"),
    );
    const etag = first!.headers.get("etag") ?? "";
    await first!.arrayBuffer();

    const second = await handler(
      fontRequest("/_demiurge/font/brand-sans-400-normal.woff2", {
        ifNoneMatch: etag,
      }),
    );

    expect(second?.status).toBe(304);
  });

  it("leaves every other path to the next handler", async () => {
    const handler = createHandler(await createRoot());

    await expect(handler(fontRequest("/about"))).resolves.toBeNull();
    await expect(handler(fontRequest("/_demiurge/font/missing.woff2")))
      .resolves.toBeNull();
  });

  it("refuses a method that cannot read a font", async () => {
    const handler = createHandler(await createRoot());
    const response = await handler(
      fontRequest("/_demiurge/font/brand-sans-400-normal.woff2", {
        method: "POST",
      }),
    );

    expect(response?.status).toBe(405);
    expect(response?.headers.get("allow")).toBe("GET, HEAD");
  });

  it("reports a source it cannot read on every request", async () => {
    const handler = createFontAssetHandler({
      fonts: defineFonts([
        font.local({ name: "Missing", src: "fonts/missing.woff2" }),
      ]),
      root: await createRoot(),
    });

    await expect(handler(fontRequest("/_demiurge/font/missing-400-normal.woff2")))
      .rejects.toThrow("could not read the font file");
    await expect(handler(fontRequest("/_demiurge/font/missing-400-normal.woff2")))
      .rejects.toThrow("could not read the font file");
  });
});
