import { describe, expect, it } from "vitest";
import {
  defineImages,
  isAllowedImageSource,
  planImageTransform,
} from "demiurge";

describe("image transform planning", () => {
  it("allows local absolute image paths by default", () => {
    expect(isAllowedImageSource("/images/hero.png")).toBe(true);
    expect(isAllowedImageSource("images/hero.png")).toBe(false);
  });

  it("requires explicit remote image allowlists", () => {
    const policy = defineImages({
      remote: ["https://images.example.com"],
    });

    expect(
      isAllowedImageSource("https://images.example.com/posts/hero.png", policy),
    ).toBe(true);
    expect(
      isAllowedImageSource("https://cdn.example.com/posts/hero.png", policy),
    ).toBe(false);
  });

  it("supports protocol, port, and pathname remote patterns", () => {
    const policy = defineImages({
      remote: [
        {
          hostname: "images.example.com",
          pathname: "/blog/*",
          port: "8443",
          protocol: "https:",
        },
      ],
    });

    expect(
      isAllowedImageSource(
        "https://images.example.com:8443/blog/hero.png",
        policy,
      ),
    ).toBe(true);
    expect(
      isAllowedImageSource(
        "https://images.example.com:8443/products/hero.png",
        policy,
      ),
    ).toBe(false);
    expect(
      isAllowedImageSource("http://images.example.com:8443/blog/hero.png", policy),
    ).toBe(false);
  });

  it("plans deterministic responsive optimizer URLs", () => {
    const plan = planImageTransform(
      {
        alt: "Hero",
        format: "webp",
        height: 600,
        priority: true,
        quality: 80,
        sizes: "(min-width: 800px) 800px, 100vw",
        src: "/images/hero.png",
        width: 800,
        widths: [1600, 800, 800],
      },
      defineImages({
        optimizerPath: "/_image",
      }),
    );

    expect(plan).toEqual({
      alt: "Hero",
      decoding: "async",
      fetchPriority: "high",
      height: 600,
      loading: "eager",
      sizes: "(min-width: 800px) 800px, 100vw",
      source: {
        kind: "local",
        src: "/images/hero.png",
      },
      src: "/_image?src=%2Fimages%2Fhero.png&w=800&q=80&f=webp",
      srcSet: [
        "/_image?src=%2Fimages%2Fhero.png&w=800&q=80&f=webp 800w",
        "/_image?src=%2Fimages%2Fhero.png&w=1600&q=80&f=webp 1600w",
      ].join(", "),
      variants: [
        {
          format: "webp",
          height: 600,
          src: "/_image?src=%2Fimages%2Fhero.png&w=800&q=80&f=webp",
          width: 800,
        },
        {
          format: "webp",
          height: 1200,
          src: "/_image?src=%2Fimages%2Fhero.png&w=1600&q=80&f=webp",
          width: 1600,
        },
      ],
      width: 800,
    });
  });

  it("rejects disallowed sources and invalid transform options", () => {
    expect(() =>
      planImageTransform({
        alt: "Hero",
        height: 600,
        src: "https://images.example.com/hero.png",
        width: 800,
      }),
    ).toThrow(
      'Image source "https://images.example.com/hero.png" is not allowed by the image policy.',
    );
    expect(() =>
      planImageTransform({
        alt: "Hero",
        height: 600,
        quality: 101,
        src: "/images/hero.png",
        width: 800,
      }),
    ).toThrow("Image quality must be an integer between 1 and 100.");
    expect(() =>
      planImageTransform({
        alt: "Hero",
        height: 0,
        src: "/images/hero.png",
        width: 800,
      }),
    ).toThrow("Image height must be a positive integer.");
  });
});
