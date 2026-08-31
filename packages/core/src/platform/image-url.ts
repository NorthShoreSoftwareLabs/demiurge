import type { ImageFormat } from "./images";
import { urlExtension } from "./url";

export type ImageSourceKind = "local" | "remote";

// The descriptor is the complete input of one variant. The build pipeline and
// the runtime optimizer both derive a file name and an encoded body from it.
export type ImageVariantDescriptor = {
  format: ImageFormat;
  quality?: number;
  sourceKind: ImageSourceKind;
  src: string;
  width: number;
};

export const defaultImageOptimizerPath = "/_demiurge/image";

const formatExtensions: Record<Exclude<ImageFormat, "auto">, string> = {
  avif: "avif",
  jpeg: "jpg",
  png: "png",
  webp: "webp",
};

const extensionFormats: Record<string, Exclude<ImageFormat, "auto">> = {
  avif: "avif",
  jpeg: "jpeg",
  jpg: "jpeg",
  png: "png",
  webp: "webp",
};

const variantNamePattern = /^(.+)\.w(\d{1,5})(?:\.q(\d{1,3}))?\.([a-z0-9]+)$/;

export function createImageOptimizerUrl(
  descriptor: ImageVariantDescriptor,
  optimizerPath: string,
) {
  const params = new URLSearchParams({
    src: descriptor.src,
    w: String(descriptor.width),
  });

  if (descriptor.quality !== undefined) {
    params.set("q", String(descriptor.quality));
  }

  if (descriptor.format !== "auto") {
    params.set("f", descriptor.format);
  }

  return `${optimizerPath}?${params.toString()}`;
}

// A static build has no optimizer process, so the variant path must describe
// the complete transform. The build reads the path back and emits the file,
// and no shared state has to cross the build and render boundary.
export function createImageVariantPath(
  descriptor: ImageVariantDescriptor,
  optimizerPath: string,
) {
  if (descriptor.sourceKind === "remote") {
    throw new Error(
      `Image source ${JSON.stringify(descriptor.src)} is remote. A static image loader can only emit a local image.`,
    );
  }

  const quality = descriptor.quality === undefined
    ? ""
    : `.q${descriptor.quality}`;

  return `${optimizerPath}${descriptor.src}.w${descriptor.width}${quality}.${
    resolveVariantExtension(descriptor)
  }`;
}

export function parseImageVariantPath(
  pathname: string,
  optimizerPath: string,
): ImageVariantDescriptor | undefined {
  if (!pathname.startsWith(`${optimizerPath}/`)) {
    return undefined;
  }

  const match = variantNamePattern.exec(pathname.slice(optimizerPath.length));

  if (!match) {
    return undefined;
  }

  const [, src, rawWidth, rawQuality, extension] = match;
  const format = extensionFormats[extension!];
  const width = Number(rawWidth);
  const quality = rawQuality === undefined ? undefined : Number(rawQuality);

  if (
    !format ||
    !imageSourceExtension(src!) ||
    width <= 0 ||
    (quality !== undefined && (quality < 1 || quality > 100))
  ) {
    return undefined;
  }

  return { format, quality, sourceKind: "local", src: src!, width };
}

export function resolveVariantExtension(descriptor: ImageVariantDescriptor) {
  if (descriptor.format !== "auto") {
    return formatExtensions[descriptor.format];
  }

  const extension = imageSourceExtension(descriptor.src);

  if (!extension) {
    throw new Error(
      `Image source ${JSON.stringify(descriptor.src)} has no known image extension. Declare an explicit format.`,
    );
  }

  return extension === "jpeg" ? "jpg" : extension;
}

export function imageSourceExtension(src: string) {
  const extension = urlExtension(src);

  return extension in extensionFormats ? extension : undefined;
}

// The build and the development server both find variants by reading the
// documents that the application rendered. A variant that no document
// references is a variant that nothing can request.
export function collectImageVariantPaths(html: string, optimizerPath: string) {
  const pattern = new RegExp(
    `${escapeRegExp(optimizerPath)}/[^"'\\s,)<>]+`,
    "g",
  );

  return [...new Set(html.match(pattern) ?? [])];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
