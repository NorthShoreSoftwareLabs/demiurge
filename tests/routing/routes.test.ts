import { describe, expect, it } from "vitest";
import { defineRoutes, route } from "demiurge";

describe("typed route builders", () => {
  it("builds static routes", () => {
    const routes = defineRoutes({
      home: route("/"),
    });

    expect(routes.home()).toBe("/");
    expect(routes.home.pattern).toBe("/");
  });

  it("builds dynamic routes from typed path input", () => {
    const routes = defineRoutes({
      blog: {
        post: route<{ slug: string }>("/blog/[slug]", ({ slug }) =>
          `/blog/${encodeURIComponent(slug)}`,
        ),
      },
    });

    expect(routes.blog.post({ slug: "hello world" })).toBe(
      "/blog/hello%20world",
    );
    expect(routes.blog.post.pattern).toBe("/blog/[slug]");
  });

  it("requires path input for dynamic routes at typecheck time", () => {
    const post = route<{ slug: string }>("/blog/[slug]", ({ slug }) => slug);

    if (false) {
      // @ts-expect-error dynamic routes require path input
      post();

      // @ts-expect-error slug must be present
      post({});
    }

    expect(post({ slug: "ok" })).toBe("ok");
  });
});
