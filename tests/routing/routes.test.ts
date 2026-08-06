import { describe, expect, it } from "vitest";
import { href, Link, type PathValue } from "demiurge";

declare module "demiurge" {
  interface RoutePathVars {
    "/": {};
    "/blog": {};
    "/blog/[slug]": { slug: PathValue };
  }

  interface RouteConcretePaths {
    "/": "/";
    "/blog": "/blog";
    "/blog/[slug]": `/blog/${PathValue}`;
  }
}

describe("typed URL routes", () => {
  it("keeps static routes as real URL strings", () => {
    expect(href("/")).toBe("/");
    expect(href("/blog")).toBe("/blog");
  });

  it("fills dynamic file route patterns from typed path values", () => {
    expect(
      href({ to: "/blog/[slug]", path: { slug: "hello world" } }),
    ).toBe("/blog/hello%20world");
  });

  it("accepts concrete dynamic URLs when they match generated route shapes", () => {
    expect(href("/blog/file-based-routing")).toBe(
      "/blog/file-based-routing",
    );
  });

  it("rejects unknown routes and invalid path values at typecheck time", () => {
    if (false) {
      // @ts-expect-error unknown URLs are not valid once route types are generated
      href("/bloog");

      // @ts-expect-error dynamic patterns require path values
      href({ to: "/blog/[slug]" });

      // @ts-expect-error path values must match the file route variables
      href({ to: "/blog/[slug]", path: { id: "bad" } });

      type DynamicLinkProps = Parameters<typeof Link<"/blog/[slug]">>[0];

      // @ts-expect-error Link requires path values for dynamic route patterns
      const invalidLinkProps: DynamicLinkProps = {
        children: "Read",
        to: "/blog/[slug]",
      };
      void invalidLinkProps;
    }

    expect(true).toBe(true);
  });
});
