import { defineRobots, renderRobots, text } from "@demiurgejs/core";

export const GET = text(renderRobots(defineRobots({
  rules: [{ allow: "/", disallow: "/private", userAgent: "*" }],
  sitemap: "https://metadata.example.test/sitemap.xml",
})), {
  headers: { "content-type": "text/plain; charset=utf-8" },
});
