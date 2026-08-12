import { describe, expect, it } from "vitest";
import {
  defineImages,
  isAllowedImageSource,
  planImageTransform,
} from "@demiurge-js/core";

describe("image transform planning", () => {
  it("allows local absolute image paths by default", () => {
    expect(isAllowedImageSource("/images/hero.png")).toBe(true);
    expect(isAllowedImageSource("images/hero.png")).toBe(false);
  });

  it("rejects local absolute image paths when local images are disabled", () => {
    expect(isAllowedImageSource("/images/hero.png", { local: false })).toBe(
      false,
    );
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

  it("rejects protocol-relative sources that could disguise a remote origin as local", () => {
    expect(isAllowedImageSource("//evil.com/hero.png")).toBe(false);
    expect(
      isAllowedImageSource("//evil.com/hero.png", {
        remote: ["https://images.example.com"],
      }),
    ).toBe(false);
  });

  it("rejects hostnames that merely contain the allowed hostname as a substring", () => {
    const policy = defineImages({
      remote: [{ hostname: "images.example.com" }],
    });

    expect(
      isAllowedImageSource("https://evil-images.example.com/hero.png", policy),
    ).toBe(false);
    expect(
      isAllowedImageSource(
        "https://images.example.com.evil.com/hero.png",
        policy,
      ),
    ).toBe(false);
  });

  it("allows any pathname when a remote pattern does not restrict one", () => {
    const policy = defineImages({
      remote: [{ hostname: "images.example.com" }],
    });

    expect(
      isAllowedImageSource("https://images.example.com/anything/here.png", policy),
    ).toBe(true);
  });

  it("rejects a mismatched port even when hostname and protocol match", () => {
    const policy = defineImages({
      remote: [{ hostname: "images.example.com", port: "8443" }],
    });

    expect(
      isAllowedImageSource("https://images.example.com:9000/hero.png", policy),
    ).toBe(false);
    expect(
      isAllowedImageSource("https://images.example.com/hero.png", policy),
    ).toBe(false);
  });

  it("matches an exact pathname pattern and rejects other paths", () => {
    const policy = defineImages({
      remote: [{ hostname: "images.example.com", pathname: "/hero.png" }],
    });

    expect(
      isAllowedImageSource("https://images.example.com/hero.png", policy),
    ).toBe(true);
    expect(
      isAllowedImageSource("https://images.example.com/hero-2.png", policy),
    ).toBe(false);
  });

  it("rejects a userinfo authority that impersonates the allowed hostname", () => {
    const policy = defineImages({
      remote: ["https://images.example.com"],
    });

    expect(
      isAllowedImageSource(
        "https://images.example.com@evil.com/hero.png",
        policy,
      ),
    ).toBe(false);
  });

  it("rejects a trailing-dot hostname even though DNS treats it as equivalent", () => {
    const policy = defineImages({
      remote: [{ hostname: "images.example.com" }],
    });

    expect(
      isAllowedImageSource("https://images.example.com./hero.png", policy),
    ).toBe(false);
  });

  it("treats a percent-encoded hostname the same as its decoded form", () => {
    const policy = defineImages({
      remote: ["https://images.example.com"],
    });

    expect(
      isAllowedImageSource("https://%69mages.example.com/hero.png", policy),
    ).toBe(true);
  });

  it("fails closed when a configured remote origin string is malformed", () => {
    const policy = defineImages({
      remote: ["not a valid url"],
    });

    expect(
      isAllowedImageSource("https://images.example.com/hero.png", policy),
    ).toBe(false);
  });

  it("rejects non-http(s) schemes such as javascript: and data: URIs", () => {
    expect(isAllowedImageSource("javascript:alert(1)")).toBe(false);
    expect(isAllowedImageSource("data:image/png;base64,aGVsbG8=")).toBe(
      false,
    );
  });

  it("produces lazy loading with no fetch priority when priority is not set", () => {
    const plan = planImageTransform({
      alt: "Hero",
      height: 100,
      src: "/images/hero.png",
      width: 100,
    });

    expect(plan.loading).toBe("lazy");
    expect(plan.fetchPriority).toBeUndefined();
  });

  it("generates default 1x and 2x width variants when widths are not provided", () => {
    const plan = planImageTransform({
      alt: "Hero",
      height: 100,
      src: "/images/hero.png",
      width: 400,
    });

    expect(plan.variants.map((variant) => variant.width)).toEqual([400, 800]);
  });

  it("omits quality and format query parameters when they are not provided", () => {
    const plan = planImageTransform({
      alt: "Hero",
      height: 100,
      src: "/images/hero.png",
      width: 100,
      widths: [100],
    });

    expect(plan.src).toBe("/_demiurge/image?src=%2Fimages%2Fhero.png&w=100");
  });

  it("classifies an allowed remote source and normalizes it in the plan", () => {
    const policy = defineImages({
      remote: ["https://images.example.com"],
    });

    const plan = planImageTransform(
      {
        alt: "Hero",
        height: 100,
        src: "https://images.example.com:443/hero.png",
        width: 100,
        widths: [100],
      },
      policy,
    );

    expect(plan.source).toEqual({
      kind: "remote",
      src: "https://images.example.com/hero.png",
    });
  });
});
