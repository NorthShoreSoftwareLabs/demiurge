import { describe, expect, it } from "vitest";
import { href, Link, page, type PathValue, type RouteProps } from "demiurge";

declare module "demiurge" {
  interface RoutePathVars {
    "/": {};
    "/blog": {};
    "/blog/[slug]": { slug: PathValue };
    "/files/[...path]": { path: PathValue };
  }

  interface RouteConcretePaths {
    "/": "/";
    "/blog": "/blog";
    "/blog/[slug]": `/blog/${PathValue}`;
    "/files/[...path]": `/files/${PathValue}`;
  }
}

describe("typed URL routes", () => {
  it("keeps static routes as real URL strings", () => {
    expect(href("/")).toBe("/");
    expect(href("/blog")).toBe("/blog");
    expect(href("/blog?test=123#comments")).toBe(
      "/blog?test=123#comments",
    );
  });

  it("builds typed search parameters with repeated-key array semantics", () => {
    expect(
      href({
        hash: "results",
        search: {
          empty: "",
          omitted: undefined,
          page: 0,
          published: false,
          q: ["first", "second", null],
        },
        to: "/blog",
      }),
    ).toBe(
      "/blog?empty=&page=0&published=false&q=first&q=second#results",
    );
  });

  it("lets structured search and hash override embedded values", () => {
    expect(
      href({
        hash: "new",
        search: { q: "safe" },
        to: "/blog?legacy=yes#old",
      }),
    ).toBe("/blog?q=safe#new");
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

  it("fills catchall route patterns segment by segment", () => {
    expect(
      href({ to: "/files/[...path]", path: { path: "docs/hello world" } }),
    ).toBe("/files/docs/hello%20world");
  });

  it("throws when a runtime dynamic target is missing path values", () => {
    expect(() =>
      href({ to: "/blog/[slug]", path: {} as never }),
    ).toThrow('Missing path value for "slug"');
  });

  it("rejects unknown routes and invalid path values at typecheck time", () => {
    typecheckOnly(() => {
      // @ts-expect-error unknown URLs are not valid once route types are generated
      href("/bloog");

      // @ts-expect-error dynamic patterns require path values
      href({ to: "/blog/[slug]" });

      // @ts-expect-error query/hash suffixes do not bypass dynamic path values
      href({ to: "/blog/[slug]?preview=true#article" });

      // @ts-expect-error path values must match the file route variables
      href({ to: "/blog/[slug]", path: { id: "bad" } });

      type DynamicLinkProps = Parameters<typeof Link<"/blog/[slug]">>[0];

      // @ts-expect-error Link requires path values for dynamic route patterns
      const invalidLinkProps: DynamicLinkProps = {
        children: "Read",
        to: "/blog/[slug]",
      };
      void invalidLinkProps;

      const routeProps = null as never as RouteProps<"/blog/[slug]">;
      const slug: string = routeProps.path.slug;
      void slug;

      // @ts-expect-error route props only expose the path variables for their route
      void routeProps.path.id;

      const typedPage = page<"/blog/[slug]">(({ path }) => {
        const pageSlug: string = path.slug;
        return pageSlug;
      });
      void typedPage;
    });

    expect(true).toBe(true);
  });
});

function typecheckOnly(_callback: () => void) {
  return;
}
