import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import {
  negotiateImageFormat,
  transformImage,
} from "../platform/image-codec";
import {
  collectImageVariantPaths,
  defaultImageOptimizerPath,
  parseImageVariantPath,
} from "../platform/image-url";
import { isAllowedImageSource, type ImagePolicy } from "../platform/images";

export type EmittedImageVariant = {
  body: Uint8Array;
  file: string;
};

export type EmitImageVariantsOptions = {
  // Every document that the build rendered. A variant reaches the output
  // only when a document references it.
  documents: readonly string[];
  // The directory that already holds the client build, including every file
  // that the Vite public directory contributed.
  outDir: string;
  policy?: ImagePolicy;
};

// The static build owns every byte it publishes. It reads the variant paths
// back out of the rendered documents. No state then has to cross the boundary
// between the application bundle and the build process.
export async function emitImageVariants(
  options: EmitImageVariantsOptions,
): Promise<EmittedImageVariant[]> {
  const outDir = resolve(options.outDir);
  const policy = options.policy ?? {};
  const optimizerPath = policy.optimizerPath ?? defaultImageOptimizerPath;
  const paths = new Set(
    options.documents.flatMap((document) =>
      collectImageVariantPaths(document, optimizerPath)
    ),
  );
  const emitted: EmittedImageVariant[] = [];
  const sources = new Map<string, Uint8Array>();

  for (const pathname of [...paths].sort()) {
    const descriptor = parseImageVariantPath(pathname, optimizerPath);

    if (!descriptor) {
      throw new Error(
        `Static output references image variant ${JSON.stringify(pathname)}, which does not describe a transform the build can emit.`,
      );
    }

    if (!isAllowedImageSource(descriptor.src, policy)) {
      throw new Error(
        `Image source ${JSON.stringify(descriptor.src)} is not allowed by the image policy.`,
      );
    }

    const sourceFile = resolveSourceFile(outDir, descriptor.src);
    let source = sources.get(sourceFile);

    if (!source) {
      source = await readSourceImage(sourceFile, descriptor.src);
      sources.set(sourceFile, source);
    }

    const encoded = await transformImage(source, {
      format: negotiateImageFormat(descriptor, null),
      quality: descriptor.quality,
      width: descriptor.width,
    });

    emitted.push({ body: encoded.body, file: pathname.slice(1) });
  }

  return emitted;
}

// A document that a static build publishes cannot reach a request-time
// optimizer. The build stops rather than publish a dead image URL.
export function assertNoOptimizerImages(
  documents: readonly string[],
  policy: ImagePolicy = {},
) {
  const optimizerPath = policy.optimizerPath ?? defaultImageOptimizerPath;
  const pattern = new RegExp(`${optimizerPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?`);

  for (const document of documents) {
    if (pattern.test(document)) {
      throw new Error(
        'Static output references the request-time image optimizer, which a static build cannot serve. Set loader: "static" in the image policy, or deploy a runtime adapter.',
      );
    }
  }
}

async function readSourceImage(sourceFile: string, src: string) {
  try {
    return new Uint8Array(await readFile(sourceFile));
  } catch (error) {
    throw new Error(
      `Demiurge could not read the source image ${JSON.stringify(src)} from the build output.`,
      { cause: error },
    );
  }
}

function resolveSourceFile(outDir: string, src: string) {
  let decoded: string;

  try {
    decoded = decodeURIComponent(src);
  } catch {
    throw new Error(`Image source is not valid UTF-8: ${JSON.stringify(src)}.`);
  }

  const file = resolve(outDir, `.${decoded}`);

  if (relative(outDir, file).split(sep).includes("..")) {
    throw new Error(
      `Image source escaped the build output directory: ${JSON.stringify(src)}.`,
    );
  }

  return file;
}
