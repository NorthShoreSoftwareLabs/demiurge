import { text } from "@demiurgejs/core";

export const GET = text(
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    "  <url><loc>https://static.example.test/</loc></url>",
    "</urlset>",
    "",
  ].join("\n"),
  { headers: { "content-type": "application/xml; charset=utf-8" } },
);
