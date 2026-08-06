import { defineRoutes, route } from "demiurge";

export const routes = defineRoutes({
  home: route("/"),
  blog: {
    index: route("/blog"),
    post: route<{ slug: string }>("/blog/[slug]", ({ slug }) =>
      `/blog/${encodeURIComponent(slug)}`,
    ),
  },
  oldBlog: route("/old-blog"),
  api: {
    health: route("/api/health"),
  },
});
