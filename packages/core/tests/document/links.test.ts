import { describe, expect, it } from "vitest";
import {
  defineLinks,
  modulePreload,
  preconnect,
  preload,
  resolveLinks,
} from "@demiurge-js/core";
import type { HttpRouteContext } from "@demiurge-js/core";

const context = {
  path: {},
  pathname: "/checkout",
  request: new Request("https://example.test/checkout?hero=true"),
  search: new URLSearchParams("hero=true"),
  url: new URL("https://example.test/checkout?hero=true"),
} satisfies HttpRouteContext;

describe("document links", () => {
  it("defines structured resource hints", async () => {
    const links = defineLinks([
      preconnect("https://api.example.com", { crossOrigin: "anonymous" }),
      preload("/hero.avif", { as: "image", type: "image/avif" }),
      modulePreload("/assets/editor.js"),
    ]);

    await expect(resolveLinks([links], context)).resolves.toEqual([
      {
        crossOrigin: "anonymous",
        href: "https://api.example.com",
        kind: "link",
        rel: "preconnect",
      },
      {
        as: "image",
        href: "/hero.avif",
        kind: "link",
        rel: "preload",
        type: "image/avif",
      },
      {
        href: "/assets/editor.js",
        kind: "link",
        rel: "modulepreload",
      },
    ]);
  });

  it("resolves request-aware link contributions before document rendering", async () => {
    const links = defineLinks(({ search }) => {
      if (search.get("hero") !== "true") {
        return [];
      }

      return [preload("/hero.avif", { as: "image" })];
    });

    await expect(resolveLinks([links], context)).resolves.toEqual([
      {
        as: "image",
        href: "/hero.avif",
        kind: "link",
        rel: "preload",
      },
    ]);
  });

  it("dedupes links by rel, href, type, as, and crossorigin", async () => {
    const links = await resolveLinks(
      [
        [
          preload("/hero.avif", { as: "image" }),
          preload("/hero.avif", { as: "image", type: "image/avif" }),
        ],
        [
          preload("/hero.avif", { as: "image" }),
          preconnect("https://api.example.com"),
        ],
      ],
      context,
    );

    expect(links).toEqual([
      {
        href: "https://api.example.com",
        kind: "link",
        rel: "preconnect",
      },
      {
        as: "image",
        href: "/hero.avif",
        kind: "link",
        rel: "preload",
      },
      {
        as: "image",
        href: "/hero.avif",
        kind: "link",
        rel: "preload",
        type: "image/avif",
      },
    ]);
  });
});
