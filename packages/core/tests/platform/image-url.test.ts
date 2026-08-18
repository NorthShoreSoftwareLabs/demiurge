import { describe, expect, it } from "vitest";
import {
  collectImageVariantPaths,
  createImageOptimizerUrl,
  createImageVariantPath,
  defaultImageOptimizerPath,
  imageSourceExtension,
  parseImageVariantPath,
  resolveVariantExtension,
  type ImageVariantDescriptor,
} from "../../src/platform/image-url";

function descriptor(
  overrides: Partial<ImageVariantDescriptor> = {},
): ImageVariantDescriptor {
  return {
    format: "auto",
    sourceKind: "local",
    src: "/images/hero.png",
    width: 800,
    ...overrides,
  };
}

describe("image optimizer urls", () => {
  it("writes an optimizer url with only the declared parameters", () => {
    expect(
      createImageOptimizerUrl(descriptor(), defaultImageOptimizerPath),
    ).toBe("/_demiurge/image?src=%2Fimages%2Fhero.png&w=800");
    expect(
      createImageOptimizerUrl(
        descriptor({ format: "webp", quality: 60 }),
        "/_image",
      ),
    ).toBe("/_image?src=%2Fimages%2Fhero.png&w=800&q=60&f=webp");
  });
});

describe("static image variant paths", () => {
  it("describes the source, the width, the quality, and the format", () => {
    expect(
      createImageVariantPath(
        descriptor({ format: "webp", quality: 72 }),
        defaultImageOptimizerPath,
      ),
    ).toBe("/_demiurge/image/images/hero.png.w800.q72.webp");
    expect(
      createImageVariantPath(descriptor(), defaultImageOptimizerPath),
    ).toBe("/_demiurge/image/images/hero.png.w800.png");
  });

  it("uses the configured optimizer path as the variant directory", () => {
    expect(createImageVariantPath(descriptor({ format: "jpeg" }), "/assets/img"))
      .toBe("/assets/img/images/hero.png.w800.jpg");
  });

  it("refuses a static variant path for a remote source", () => {
    expect(() =>
      createImageVariantPath(
        descriptor({
          sourceKind: "remote",
          src: "https://images.example.com/hero.png",
        }),
        defaultImageOptimizerPath,
      )
    ).toThrow(
      'Image source "https://images.example.com/hero.png" is remote. A static image loader can only emit a local image.',
    );
  });

  it("keeps the source extension when the format is auto", () => {
    expect(resolveVariantExtension(descriptor({ src: "/a/hero.jpeg" }))).toBe("jpg");
    expect(resolveVariantExtension(descriptor({ src: "/a/hero.AVIF" }))).toBe("avif");
  });

  it("refuses an auto format when the source has no image extension", () => {
    expect(() => resolveVariantExtension(descriptor({ src: "/images/hero" })))
      .toThrow(
        'Image source "/images/hero" has no known image extension. Declare an explicit format.',
      );
    expect(() => resolveVariantExtension(descriptor({ src: "/images/hero.gif" })))
      .toThrow("Declare an explicit format.");
  });

  it("reads a known extension and ignores a query or fragment", () => {
    expect(imageSourceExtension("/images/hero.png?v=2")).toBe("png");
    expect(imageSourceExtension("/images/hero.webp#top")).toBe("webp");
    expect(imageSourceExtension("/images/hero.gif")).toBeUndefined();
    expect(imageSourceExtension("/images/hero")).toBeUndefined();
  });

  it("reads back every variant path that it writes", () => {
    const descriptors = [
      descriptor({ format: "webp", quality: 72 }),
      descriptor({ format: "avif", width: 1 }),
      descriptor({ format: "jpeg", src: "/a/b/c/photo.jpg", width: 99999 }),
      descriptor({ format: "png", quality: 100 }),
    ];

    for (const value of descriptors) {
      const path = createImageVariantPath(value, defaultImageOptimizerPath);

      expect(parseImageVariantPath(path, defaultImageOptimizerPath)).toEqual({
        format: value.format,
        quality: value.quality,
        sourceKind: "local",
        src: value.src,
        width: value.width,
      });
    }
  });

  it("reads a jpg variant path back as the jpeg format", () => {
    expect(
      parseImageVariantPath(
        "/_demiurge/image/images/hero.jpg.w200.jpg",
        defaultImageOptimizerPath,
      ),
    ).toEqual({
      format: "jpeg",
      quality: undefined,
      sourceKind: "local",
      src: "/images/hero.jpg",
      width: 200,
    });
  });

  it("reads a variant path under the configured optimizer path only", () => {
    expect(parseImageVariantPath("/img/a/hero.png.w200.png", "/img")).toEqual({
      format: "png",
      quality: undefined,
      sourceKind: "local",
      src: "/a/hero.png",
      width: 200,
    });
    expect(
      parseImageVariantPath("/img/a/hero.png.w200.png", "/_demiurge/image"),
    ).toBeUndefined();
  });

  it("refuses a path that does not describe a complete transform", () => {
    for (
      const path of [
        "/_demiurge/image",
        "/_demiurge/image/hero.png",
        "/_demiurge/image/hero.png.w200.gif",
        "/_demiurge/image/hero.w200.png",
        "/_demiurge/image/hero.png.w0.png",
        "/_demiurge/image/hero.png.w200.q0.png",
        "/_demiurge/image/hero.png.w200.q101.png",
        "/_demiurge/image/hero.png.w1000000.png",
      ]
    ) {
      expect(parseImageVariantPath(path, defaultImageOptimizerPath))
        .toBeUndefined();
    }
  });
});

describe("image variant discovery", () => {
  it("finds every distinct variant path in a rendered document", () => {
    const html = '<img src="/_demiurge/image/a/hero.png.w200.webp"' +
      ' srcSet="/_demiurge/image/a/hero.png.w200.webp 200w,' +
      ' /_demiurge/image/a/hero.png.w400.webp 400w"/>' +
      '<a href="/about">About</a>';

    expect(collectImageVariantPaths(html, defaultImageOptimizerPath)).toEqual([
      "/_demiurge/image/a/hero.png.w200.webp",
      "/_demiurge/image/a/hero.png.w400.webp",
    ]);
  });

  it("finds nothing when a document references no variant", () => {
    expect(
      collectImageVariantPaths("<main>No image</main>", "/_demiurge/image"),
    ).toEqual([]);
  });

  it("treats the optimizer path as a literal rather than a pattern", () => {
    expect(collectImageVariantPaths('<img src="/aXb/hero.png.w200.png"/>', "/a.b"))
      .toEqual([]);
  });
});
