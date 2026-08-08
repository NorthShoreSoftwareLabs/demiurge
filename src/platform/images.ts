export type ImageFormat = "auto" | "avif" | "webp" | "jpeg" | "png";

export type RemoteImagePattern = {
  hostname: string;
  pathname?: string;
  port?: string;
  protocol?: "http:" | "https:";
};

export type ImagePolicy = {
  local?: boolean;
  optimizerPath?: string;
  remote?: readonly (string | RemoteImagePattern)[];
};

export type ImageTransformOptions = {
  alt: string;
  format?: ImageFormat;
  height: number;
  priority?: boolean;
  quality?: number;
  sizes?: string;
  src: string;
  width: number;
  widths?: readonly number[];
};

export type ImageVariant = {
  format: ImageFormat;
  height: number;
  src: string;
  width: number;
};

export type ImageTransformPlan = {
  alt: string;
  decoding: "async";
  fetchPriority?: "high";
  height: number;
  loading: "eager" | "lazy";
  sizes?: string;
  source: {
    kind: "local" | "remote";
    src: string;
  };
  src: string;
  srcSet: string;
  variants: ImageVariant[];
  width: number;
};

const defaultOptimizerPath = "/_demiurge/image";

export function defineImages(policy: ImagePolicy): ImagePolicy {
  return policy;
}

export function isAllowedImageSource(src: string, policy: ImagePolicy = {}) {
  return classifyImageSource(src, policy) !== null;
}

export function planImageTransform(
  options: ImageTransformOptions,
  policy: ImagePolicy = {},
): ImageTransformPlan {
  const source = classifyImageSource(options.src, policy);

  if (!source) {
    throw new Error(`Image source "${options.src}" is not allowed by the image policy.`);
  }

  validateImageDimension("width", options.width);
  validateImageDimension("height", options.height);
  validateImageQuality(options.quality);

  const format = options.format ?? "auto";
  const widths = normalizeVariantWidths(options.width, options.widths);
  const variants = widths.map((width) => {
    const height = Math.round((options.height / options.width) * width);

    return {
      format,
      height,
      src: createOptimizerUrl({
        format,
        optimizerPath: policy.optimizerPath ?? defaultOptimizerPath,
        quality: options.quality,
        src: options.src,
        width,
      }),
      width,
    };
  });
  const primaryVariant = variants[0];

  return {
    alt: options.alt,
    decoding: "async",
    fetchPriority: options.priority ? "high" : undefined,
    height: options.height,
    loading: options.priority ? "eager" : "lazy",
    sizes: options.sizes,
    source,
    src: primaryVariant.src,
    srcSet: variants
      .map((variant) => `${variant.src} ${variant.width}w`)
      .join(", "),
    variants,
    width: options.width,
  };
}

function classifyImageSource(
  src: string,
  policy: ImagePolicy,
): ImageTransformPlan["source"] | null {
  if (src.startsWith("/")) {
    return policy.local === false ? null : { kind: "local", src };
  }

  let url: URL;

  try {
    url = new URL(src);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  return isAllowedRemoteImage(url, policy.remote ?? [])
    ? { kind: "remote", src: url.toString() }
    : null;
}

function isAllowedRemoteImage(
  url: URL,
  remotes: readonly (string | RemoteImagePattern)[],
) {
  return remotes.some((remote) =>
    typeof remote === "string"
      ? matchesRemoteOrigin(url, remote)
      : matchesRemotePattern(url, remote),
  );
}

function matchesRemoteOrigin(url: URL, origin: string) {
  try {
    return url.origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

function matchesRemotePattern(url: URL, pattern: RemoteImagePattern) {
  if (pattern.protocol && url.protocol !== pattern.protocol) {
    return false;
  }

  if (url.hostname !== pattern.hostname) {
    return false;
  }

  if (pattern.port !== undefined && url.port !== pattern.port) {
    return false;
  }

  return pattern.pathname
    ? matchesPathnamePattern(url.pathname, pattern.pathname)
    : true;
}

function matchesPathnamePattern(pathname: string, pattern: string) {
  if (pattern.endsWith("*")) {
    return pathname.startsWith(pattern.slice(0, -1));
  }

  return pathname === pattern;
}

function validateImageDimension(name: "height" | "width", value: number) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Image ${name} must be a positive integer.`);
  }
}

function validateImageQuality(quality: number | undefined) {
  if (quality === undefined) {
    return;
  }

  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new Error("Image quality must be an integer between 1 and 100.");
  }
}

function normalizeVariantWidths(width: number, widths: readonly number[] | undefined) {
  const candidates = widths ?? [width, width * 2];
  const uniqueWidths = [...new Set(candidates)];

  for (const candidate of uniqueWidths) {
    validateImageDimension("width", candidate);
  }

  return uniqueWidths.sort((left, right) => left - right);
}

function createOptimizerUrl({
  format,
  optimizerPath,
  quality,
  src,
  width,
}: {
  format: ImageFormat;
  optimizerPath: string;
  quality: number | undefined;
  src: string;
  width: number;
}) {
  const params = new URLSearchParams({
    src,
    w: String(width),
  });

  if (quality !== undefined) {
    params.set("q", String(quality));
  }

  if (format !== "auto") {
    params.set("f", format);
  }

  return `${optimizerPath}?${params.toString()}`;
}
