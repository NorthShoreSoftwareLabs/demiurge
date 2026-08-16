import { defineOgImage, renderOgImageResponse, response } from "@demiurgejs/core";

export const GET = response(({ path }) => renderOgImageResponse(defineOgImage({
  brand: "Demiurge Metadata Blog",
  subtitle: "Typed routes and secure document output",
  title: path.slug,
})));
