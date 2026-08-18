import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineImages } from "@demiurgejs/core";
import { createImageOptimizer } from "@demiurgejs/core/node";
import { parseImageVariantPath } from "../../src/platform/image-url";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

async function createSourceImage(width = 400, height = 200) {
  return new Uint8Array(
    await sharp({
      create: { background: "#204080", channels: 3, height, width },
    }).png().toBuffer(),
  );
}

async function createRoot() {
  const root = await mkdtemp(join(tmpdir(), "demiurge-optimizer-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "images"), { recursive: true });
  await writeFile(join(root, "images", "hero.png"), await createSourceImage());

  return root;
}

function imageRequest(
  search: string,
  init: { accept?: string; ifNoneMatch?: string; method?: string } = {},
) {
  const headers = new Headers();

  if (init.accept) headers.set("accept", init.accept);
  if (init.ifNoneMatch) headers.set("if-none-match", init.ifNoneMatch);

  return new Request(`https://example.test${search}`, {
    headers,
    method: init.method ?? "GET",
  });
}

describe("node image optimizer", () => {
  it("ignores a request for another path", async () => {
    const optimize = createImageOptimizer({ root: await createRoot() });

    await expect(optimize(imageRequest("/images/hero.png"))).resolves
      .toBeNull();
  });

  it("resizes and reencodes a local image", async () => {
    const optimize = createImageOptimizer({ root: await createRoot() });
    const response = await optimize(
      imageRequest("/_demiurge/image?src=%2Fimages%2Fhero.png&w=100&f=webp"),
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("image/webp");
    expect(response?.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(response?.headers.get("vary")).toBeNull();

    const body = new Uint8Array(await response!.arrayBuffer());

    expect(Number(response?.headers.get("content-length")))
      .toBe(body.byteLength);
    await expect(sharp(body).metadata()).resolves.toMatchObject({
      format: "webp",
      width: 100,
    });
  });

  it("negotiates the format and varies on accept when none is declared", async () => {
    const optimize = createImageOptimizer({ root: await createRoot() });
    const avif = await optimize(
      imageRequest("/_demiurge/image?src=%2Fimages%2Fhero.png&w=80", {
        accept: "image/avif,image/webp,*/*",
      }),
    );
    const png = await optimize(
      imageRequest("/_demiurge/image?src=%2Fimages%2Fhero.png&w=80", {
        accept: "*/*",
      }),
    );

    expect(avif?.headers.get("content-type")).toBe("image/avif");
    expect(avif?.headers.get("vary")).toBe("accept");
    expect(png?.headers.get("content-type")).toBe("image/png");
    expect(avif?.headers.get("etag")).not.toBe(png?.headers.get("etag"));
  });

  it("answers a matching entity tag with 304 and no body", async () => {
    const optimize = createImageOptimizer({ root: await createRoot() });
    const first = await optimize(
      imageRequest("/_demiurge/image?src=%2Fimages%2Fhero.png&w=64&f=png"),
    );
    const etag = first!.headers.get("etag")!;
    const second = await optimize(
      imageRequest("/_demiurge/image?src=%2Fimages%2Fhero.png&w=64&f=png", {
        ifNoneMatch: etag,
      }),
    );

    expect(second?.status).toBe(304);
    expect(second?.headers.get("etag")).toBe(etag);
    await expect(second!.text()).resolves.toBe("");
  });

  it("answers HEAD with the headers and no body", async () => {
    const optimize = createImageOptimizer({ root: await createRoot() });
    const response = await optimize(
      imageRequest("/_demiurge/image?src=%2Fimages%2Fhero.png&w=64&f=png", {
        method: "HEAD",
      }),
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("image/png");
    await expect(response!.text()).resolves.toBe("");
  });

  it("refuses a method that cannot read an image", async () => {
    const optimize = createImageOptimizer({ root: await createRoot() });
    const response = await optimize(
      imageRequest("/_demiurge/image?src=%2Fimages%2Fhero.png&w=64", {
        method: "POST",
      }),
    );

    expect(response?.status).toBe(405);
    expect(response?.headers.get("allow")).toBe("GET, HEAD");
  });

  it("rejects an invalid request before it reads a file", async () => {
    const optimize = createImageOptimizer({ root: await createRoot() });

    await expect(optimize(imageRequest("/_demiurge/image?w=64")).then(
      (response) => response?.status,
    )).resolves.toBe(400);
    await expect(
      optimize(imageRequest("/_demiurge/image?src=%2Fa.png&w=0")).then(
        (response) => response?.status,
      ),
    ).resolves.toBe(400);
    await expect(
      optimize(imageRequest("/_demiurge/image?src=%2Fa.png&w=64&q=101")).then(
        (response) => response?.status,
      ),
    ).resolves.toBe(400);
    await expect(
      optimize(imageRequest("/_demiurge/image?src=%2Fa.png&w=64&f=gif")).then(
        (response) => response?.status,
      ),
    ).resolves.toBe(400);
  });

  it("refuses a source that the image policy does not allow", async () => {
    const optimize = createImageOptimizer({ root: await createRoot() });
    const response = await optimize(
      imageRequest(
        "/_demiurge/image?src=https%3A%2F%2Fevil.test%2Fhero.png&w=64",
      ),
    );

    expect(response?.status).toBe(403);
    await expect(response!.text()).resolves.toBe(
      "The image policy does not allow this image source.",
    );
  });

  it("answers 404 for a local source that does not exist", async () => {
    const optimize = createImageOptimizer({ root: await createRoot() });
    const response = await optimize(
      imageRequest("/_demiurge/image?src=%2Fimages%2Fmissing.png&w=64"),
    );

    expect(response?.status).toBe(404);
  });

  it("refuses a local source that leaves the root directory", async () => {
    const optimize = createImageOptimizer({ root: await createRoot() });
    const response = await optimize(
      imageRequest("/_demiurge/image?src=%2F..%2Fhero.png&w=64"),
    );

    expect(response?.status).toBe(404);
  });

  it("optimizes an allowed remote image", async () => {
    const source = await createSourceImage();
    const load = vi.fn(async () =>
      new Response(source, { headers: { "content-type": "image/png" } })
    );
    const optimize = createImageOptimizer({
      fetch: load,
      policy: defineImages({ remote: ["https://images.example.com"] }),
      root: await createRoot(),
    });
    const response = await optimize(
      imageRequest(
        "/_demiurge/image?src=https%3A%2F%2Fimages.example.com%2Fhero.png&w=50&f=webp",
      ),
    );

    expect(load).toHaveBeenCalledWith("https://images.example.com/hero.png");
    expect(response?.status).toBe(200);
    await expect(sharp(new Uint8Array(await response!.arrayBuffer())).metadata())
      .resolves.toMatchObject({ width: 50 });
  });

  it("answers 404 when the remote image is not available", async () => {
    const optimize = createImageOptimizer({
      fetch: async () => new Response("missing", { status: 404 }),
      policy: defineImages({ remote: ["https://images.example.com"] }),
      root: await createRoot(),
    });
    const response = await optimize(
      imageRequest(
        "/_demiurge/image?src=https%3A%2F%2Fimages.example.com%2Fhero.png&w=50",
      ),
    );

    expect(response?.status).toBe(404);
  });

  it("answers 404 when the remote image is larger than the read limit", async () => {
    const optimize = createImageOptimizer({
      fetch: async () => new Response(new Uint8Array(21 * 1024 * 1024)),
      policy: defineImages({ remote: ["https://images.example.com"] }),
      root: await createRoot(),
    });
    const response = await optimize(
      imageRequest(
        "/_demiurge/image?src=https%3A%2F%2Fimages.example.com%2Fhero.png&w=50",
      ),
    );

    expect(response?.status).toBe(404);
  });

  it("serves a repeated request from the encoded cache", async () => {
    const optimize = createImageOptimizer({ root: await createRoot() });
    const search = "/_demiurge/image?src=%2Fimages%2Fhero.png&w=70&f=png";
    const first = await optimize(imageRequest(search));
    const second = await optimize(imageRequest(search));

    expect(second?.headers.get("etag")).toBe(first!.headers.get("etag"));
  });

  it("drops the least recent entry when the cache is full", async () => {
    const optimize = createImageOptimizer({
      cacheSize: 1,
      root: await createRoot(),
    });

    for (const width of [10, 20, 30, 10]) {
      const response = await optimize(
        imageRequest(`/_demiurge/image?src=%2Fimages%2Fhero.png&w=${width}&f=png`),
      );

      expect(response?.status).toBe(200);
    }
  });

  it("serves a static loader variant path that a resolver reads", async () => {
    const optimize = createImageOptimizer({
      resolveVariant: (pathname) =>
        parseImageVariantPath(pathname, "/_demiurge/image"),
      root: await createRoot(),
    });

    await expect(optimize(imageRequest("/_demiurge/image/other.webp")))
      .resolves.toBeNull();

    const response = await optimize(
      imageRequest("/_demiurge/image/images/hero.png.w120.webp", {
        accept: "image/avif",
      }),
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("image/webp");
    expect(response?.headers.get("vary")).toBeNull();
    await expect(sharp(new Uint8Array(await response!.arrayBuffer())).metadata())
      .resolves.toMatchObject({ width: 120 });
  });

  it("refuses a variant path whose source the policy does not allow", async () => {
    const optimize = createImageOptimizer({
      policy: defineImages({ local: false }),
      resolveVariant: (pathname) =>
        parseImageVariantPath(pathname, "/_demiurge/image"),
      root: await createRoot(),
    });
    const response = await optimize(
      imageRequest("/_demiurge/image/images/hero.png.w120.webp"),
    );

    expect(response?.status).toBe(403);
  });

  it("serves the optimizer path that the image policy declares", async () => {
    const optimize = createImageOptimizer({
      policy: defineImages({ optimizerPath: "/_image" }),
      root: await createRoot(),
    });

    await expect(
      optimize(imageRequest("/_demiurge/image?src=%2Fimages%2Fhero.png&w=64")),
    ).resolves.toBeNull();
    await expect(
      optimize(imageRequest("/_image?src=%2Fimages%2Fhero.png&w=64&f=png"))
        .then((response) => response?.status),
    ).resolves.toBe(200);
  });
});
