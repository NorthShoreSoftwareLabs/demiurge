import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  imageContentType,
  negotiateImageFormat,
  sourceFormat,
  transformImage,
} from "../../src/platform/image-codec";
import type { ImageVariantDescriptor } from "../../src/platform/image-url";

function descriptor(
  overrides: Partial<ImageVariantDescriptor> = {},
): ImageVariantDescriptor {
  return {
    format: "auto",
    sourceKind: "local",
    src: "/images/hero.png",
    width: 40,
    ...overrides,
  };
}

async function createSourceImage(width: number, height: number) {
  return new Uint8Array(
    await sharp({
      create: { background: "#3355ff", channels: 3, height, width },
    }).png().toBuffer(),
  );
}

describe("image codec", () => {
  it("keeps an explicit format and ignores the accept header", () => {
    expect(
      negotiateImageFormat(descriptor({ format: "png" }), "image/avif"),
    ).toBe("png");
  });

  it("prefers avif, then webp, then the source format", () => {
    expect(
      negotiateImageFormat(descriptor(), "image/avif,image/webp,*/*"),
    ).toBe("avif");
    expect(negotiateImageFormat(descriptor(), "image/webp,*/*")).toBe("webp");
    expect(negotiateImageFormat(descriptor(), "*/*")).toBe("png");
    expect(negotiateImageFormat(descriptor(), null)).toBe("png");
  });

  it("reads the source format from the source extension", () => {
    expect(sourceFormat("/a/hero.png")).toBe("png");
    expect(sourceFormat("/a/hero.webp")).toBe("webp");
    expect(sourceFormat("/a/hero.avif")).toBe("avif");
    expect(sourceFormat("/a/hero.jpg")).toBe("jpeg");
    expect(sourceFormat("/a/hero")).toBe("jpeg");
  });

  it("names one content type for each supported format", () => {
    expect(imageContentType("avif")).toBe("image/avif");
    expect(imageContentType("jpeg")).toBe("image/jpeg");
    expect(imageContentType("png")).toBe("image/png");
    expect(imageContentType("webp")).toBe("image/webp");
  });

  it("resizes and reencodes a source image", async () => {
    const source = await createSourceImage(120, 60);
    const encoded = await transformImage(source, { format: "webp", width: 40 });

    expect(encoded.contentType).toBe("image/webp");
    expect(encoded.body.byteLength).toBeGreaterThan(0);
    expect(encoded.body.byteLength).toBeLessThan(source.byteLength);
    await expect(readSize(encoded.body)).resolves.toEqual({
      height: 20,
      width: 40,
    });
  });

  it("encodes every supported output format", async () => {
    const source = await createSourceImage(64, 64);

    for (const format of ["avif", "jpeg", "png", "webp"] as const) {
      const encoded = await transformImage(source, {
        format,
        quality: 60,
        width: 32,
      });

      expect(encoded.contentType).toBe(imageContentType(format));
      await expect(readSize(encoded.body)).resolves.toEqual({
        height: 32,
        width: 32,
      });
    }
  });

  it("does not enlarge a source that is smaller than the requested width", async () => {
    const source = await createSourceImage(20, 10);
    const encoded = await transformImage(source, { format: "png", width: 400 });

    await expect(readSize(encoded.body)).resolves.toEqual({
      height: 10,
      width: 20,
    });
  });
});

async function readSize(body: Uint8Array) {
  const metadata = await sharp(body).metadata();

  return { height: metadata.height, width: metadata.width };
}
