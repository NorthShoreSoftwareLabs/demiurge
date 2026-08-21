import type { ImageFormat } from "./images";
import { imageSourceExtension, type ImageVariantDescriptor } from "./image-url";

export type EncodedImage = {
  body: Uint8Array;
  contentType: string;
};

type SharpModule = {
  default: (input: Uint8Array) => SharpPipeline;
};

type SharpPipeline = {
  avif: (options: { quality: number }) => SharpPipeline;
  jpeg: (options: { quality: number }) => SharpPipeline;
  png: () => SharpPipeline;
  resize: (options: {
    width: number;
    withoutEnlargement: boolean;
  }) => SharpPipeline;
  toBuffer: () => Promise<Buffer>;
  webp: (options: { quality: number }) => SharpPipeline;
};

const contentTypes: Record<Exclude<ImageFormat, "auto">, string> = {
  avif: "image/avif",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const defaultQuality = 75;

export function imageContentType(format: Exclude<ImageFormat, "auto">) {
  return contentTypes[format];
}

// `auto` lets the browser take the smallest format that it accepts. A client
// that sends no usable `accept` header keeps the source format.
export function negotiateImageFormat(
  descriptor: ImageVariantDescriptor,
  accept: string | null,
): Exclude<ImageFormat, "auto"> {
  if (descriptor.format !== "auto") {
    return descriptor.format;
  }

  const accepted = (accept ?? "").toLowerCase();

  if (accepted.includes("image/avif")) {
    return "avif";
  }

  if (accepted.includes("image/webp")) {
    return "webp";
  }

  return sourceFormat(descriptor.src);
}

export function sourceFormat(src: string): Exclude<ImageFormat, "auto"> {
  const extension = imageSourceExtension(src);

  if (extension === "avif") {
    return "avif";
  }

  if (extension === "webp") {
    return "webp";
  }

  if (extension === "png") {
    return "png";
  }

  return "jpeg";
}

export async function transformImage(
  source: Uint8Array,
  options: {
    format: Exclude<ImageFormat, "auto">;
    quality?: number;
    width: number;
  },
): Promise<EncodedImage> {
  const sharp = await loadImageCodec();
  const quality = options.quality ?? defaultQuality;
  const resized = sharp(source).resize({
    width: options.width,
    withoutEnlargement: true,
  });

  return {
    body: new Uint8Array(await encode(resized, options.format, quality)),
    contentType: contentTypes[options.format],
  };
}

function encode(
  pipeline: SharpPipeline,
  format: Exclude<ImageFormat, "auto">,
  quality: number,
) {
  if (format === "png") {
    return pipeline.png().toBuffer();
  }

  if (format === "jpeg") {
    return pipeline.jpeg({ quality }).toBuffer();
  }

  if (format === "avif") {
    return pipeline.avif({ quality }).toBuffer();
  }

  return pipeline.webp({ quality }).toBuffer();
}

// `sharp` is an optional peer dependency. Only an application that optimizes
// an image installs it, the same rule that ADR 0006 states for a host
// adapter dependency.
async function loadImageCodec() {
  let module: SharpModule;

  try {
    // SAFETY: sharp ships no types. The local type describes the methods the codec calls.
    module = (await import("sharp")) as SharpModule;
  } catch (error) {
    throw new Error(
      "Demiurge image optimization requires the optional peer dependency sharp. Install sharp in the application.",
      { cause: error },
    );
  }

  return module.default;
}
