import { defineSitemap, renderSitemap, text } from "@demiurgejs/core";

export const GET = text(renderSitemap(defineSitemap([
  {
    changeFrequency: "weekly",
    priority: 1,
    url: "https://metadata.example.test/",
  },
  {
    changeFrequency: "monthly",
    priority: 0.8,
    url: "https://metadata.example.test/posts/secure-routing",
  },
])), {
  headers: { "content-type": "application/xml; charset=utf-8" },
});
