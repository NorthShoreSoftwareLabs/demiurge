import { defineImages } from "@demiurgejs/core";

// The Node server runs the optimizer endpoint, so the default optimizer
// loader keeps one URL for every width, quality, and negotiated format.
export const images = defineImages({});
