import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Image, defineImages } from "@demiurgejs/core";

describe("Image component", () => {
  it("renders the planned attributes of a lazy image", () => {
    const html = renderToStaticMarkup(
      <Image
        alt="Hero"
        height={100}
        src="/images/hero.png"
        width={200}
        widths={[200]}
      />,
    );

    expect(html).toBe(
      '<img alt="Hero" decoding="async" height="100" loading="lazy"' +
        ' src="/_demiurge/image?src=%2Fimages%2Fhero.png&amp;w=200"' +
        ' srcSet="/_demiurge/image?src=%2Fimages%2Fhero.png&amp;w=200 200w"' +
        ' width="200"/>',
    );
  });

  it("marks a priority image as eager with a high fetch priority", () => {
    const html = renderToStaticMarkup(
      <Image
        alt="Hero"
        height={100}
        priority
        sizes="100vw"
        src="/images/hero.png"
        width={200}
        widths={[200]}
      />,
    );

    expect(html).toContain('loading="eager"');
    expect(html).toContain('fetchPriority="high"');
    expect(html).toContain('sizes="100vw"');
    expect(html).toContain('<link rel="preload" as="image"');
  });

  it("passes the class name and id through to the element", () => {
    const html = renderToStaticMarkup(
      <Image
        alt="Hero"
        className="hero"
        height={100}
        id="hero-image"
        src="/images/hero.png"
        width={200}
        widths={[200]}
      />,
    );

    expect(html).toContain('class="hero"');
    expect(html).toContain('id="hero-image"');
  });

  it("uses the static loader path when the policy declares one", () => {
    const html = renderToStaticMarkup(
      <Image
        alt="Hero"
        format="webp"
        height={100}
        policy={defineImages({ loader: "static" })}
        src="/images/hero.png"
        width={200}
        widths={[200]}
      />,
    );

    expect(html).toContain(
      'src="/_demiurge/image/images/hero.png.w200.webp"',
    );
  });

  it("refuses to render an image that the policy does not allow", () => {
    expect(() =>
      renderToStaticMarkup(
        <Image
          alt="Hero"
          height={100}
          src="https://images.example.com/hero.png"
          width={200}
        />,
      )
    ).toThrow("is not allowed by the image policy");
  });
});
