import { defineImages } from "@demiurgejs/core";

// A static export has no application server. The static loader makes the
// build emit one file for each planned variant.
export const images = defineImages({ loader: "static" });
